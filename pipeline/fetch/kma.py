"""기상청 단기예보(공공데이터포털 VilageFcstInfoService_2.0) 수집과 예보 연장.

- 단기예보는 발표시각 기준 약 3일치 시간별 예보를 준다 → 일별로 집계
- 3일 이후~전망 기간(10일)은 '지속성 + 최근 평균' 대체값으로 채우고 is_forecast=True로 표시
  (중기예보 API 연동은 TODO: MidFcstInfoService/getMidTa, getMidLandFcst, regId 필요)
"""
from __future__ import annotations

import logging
import math
import re
from collections import defaultdict
from datetime import date, datetime, timedelta
from statistics import mean
from typing import Optional

from models._base import DailyWeather

from .. import config
from .http import get

log = logging.getLogger(__name__)


# --- 위경도 → 기상청 격자(LCC) ------------------------------------------------
def latlon_to_grid(lat: float, lon: float) -> tuple[int, int]:
    RE, GRID = 6371.00877, 5.0
    SLAT1, SLAT2, OLON, OLAT, XO, YO = 30.0, 60.0, 126.0, 38.0, 43, 136
    DEGRAD = math.pi / 180.0
    re_ = RE / GRID
    slat1, slat2 = SLAT1 * DEGRAD, SLAT2 * DEGRAD
    olon, olat = OLON * DEGRAD, OLAT * DEGRAD
    sn = math.tan(math.pi * 0.25 + slat2 * 0.5) / math.tan(math.pi * 0.25 + slat1 * 0.5)
    sn = math.log(math.cos(slat1) / math.cos(slat2)) / math.log(sn)
    sf = math.tan(math.pi * 0.25 + slat1 * 0.5)
    sf = sf ** sn * math.cos(slat1) / sn
    ro = math.tan(math.pi * 0.25 + olat * 0.5)
    ro = re_ * sf / ro ** sn
    ra = math.tan(math.pi * 0.25 + lat * DEGRAD * 0.5)
    ra = re_ * sf / ra ** sn
    theta = lon * DEGRAD - olon
    if theta > math.pi:
        theta -= 2.0 * math.pi
    if theta < -math.pi:
        theta += 2.0 * math.pi
    theta *= sn
    x = int(ra * math.sin(theta) + XO + 0.5)
    y = int(ro - ra * math.cos(theta) + YO + 0.5)
    return x, y


def latest_base(now: Optional[datetime] = None) -> tuple[str, str]:
    """가장 최근 발표된 단기예보의 base_date/base_time."""
    now = now or datetime.now()
    cand = now - timedelta(minutes=10)
    for bt in reversed(config.KMA_BASE_TIMES):
        if cand.strftime("%H%M") >= bt:
            return cand.strftime("%Y%m%d"), bt
    y = cand - timedelta(days=1)
    return y.strftime("%Y%m%d"), config.KMA_BASE_TIMES[-1]


_PCP_NUM = re.compile(r"(\d+(?:\.\d+)?)")


def parse_pcp(v: str) -> float:
    """'강수없음' → 0, '1.0mm' → 1.0, '30.0~50.0mm' → 40.0, '1mm 미만' → 0.5, '50.0mm 이상' → 50"""
    if not v or "없음" in v:
        return 0.0
    nums = [float(x) for x in _PCP_NUM.findall(v)]
    if not nums:
        return 0.0
    if "미만" in v:
        return nums[0] / 2.0
    if "~" in v and len(nums) >= 2:
        return (nums[0] + nums[1]) / 2.0
    return nums[0]


def fetch_vilage_fcst(key: str, nx: int, ny: int, base: Optional[tuple[str, str]] = None) -> list[DailyWeather]:
    """단기예보 → 일별 집계. 오늘(발표일) 이후 날짜만 돌려준다."""
    base_date, base_time = base or latest_base()
    r = get(
        config.KMA_VILAGE_FCST,
        {
            "serviceKey": key,
            "numOfRows": 1000,
            "pageNo": 1,
            "dataType": "JSON",
            "base_date": base_date,
            "base_time": base_time,
            "nx": nx,
            "ny": ny,
        },
    )
    try:
        body = r.json()["response"]["body"]["items"]["item"]
    except (ValueError, KeyError) as e:
        raise RuntimeError(f"단기예보 응답 해석 실패: {r.text[:300]}") from e
    by_day: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    for it in body:
        cat, d, v = it["category"], it["fcstDate"], it["fcstValue"]
        if cat == "PCP":
            by_day[d]["PCP"].append(parse_pcp(v))
        elif cat in {"TMP", "TMX", "TMN", "REH", "POP", "WSD"}:
            try:
                by_day[d][cat].append(float(v))
            except ValueError:
                pass
    out: list[DailyWeather] = []
    issued = datetime.strptime(base_date, "%Y%m%d").date()
    for d_str in sorted(by_day):
        d = datetime.strptime(d_str, "%Y%m%d").date()
        if d <= issued:
            continue
        v = by_day[d_str]
        tmp = v.get("TMP", [])
        if len(tmp) < 12:  # 반나절 미만만 있는 마지막 날은 버림
            continue
        rain = sum(v.get("PCP", []))
        rain_hours = float(sum(1 for p in v.get("PCP", []) if p > 0))
        out.append(
            DailyWeather(
                date=d,
                tavg=mean(tmp),
                tmax=max(v["TMX"]) if v.get("TMX") else max(tmp),
                tmin=min(v["TMN"]) if v.get("TMN") else min(tmp),
                rh=mean(v["REH"]) if v.get("REH") else None,
                rain=rain,
                rain_hours=rain_hours,
                wind=mean(v["WSD"]) if v.get("WSD") else None,
                is_forecast=True,
            )
        )
    return out


def extend_forecast(observed: list[DailyWeather], forecast: list[DailyWeather], until: date) -> list[DailyWeather]:
    """단기예보 이후 날짜를 최근 14일 평균(지속성)으로 채운다. 중기예보 연동 전 임시."""
    series = sorted(observed + forecast, key=lambda w: w.date)
    if not series:
        return []
    recent = [w for w in series if not w.is_forecast][-14:] or series[-14:]

    def avg(attr: str) -> Optional[float]:
        vals = [getattr(w, attr) for w in recent if getattr(w, attr) is not None]
        return mean(vals) if vals else None

    rain_days = sum(1 for w in recent if (w.rain or 0) >= 1.0)
    p_rain = rain_days / len(recent) if recent else 0.0
    mean_rain = avg("rain") or 0.0
    last = series[-1].date
    d = last + timedelta(days=1)
    while d <= until:
        series.append(
            DailyWeather(
                date=d,
                tavg=avg("tavg"),
                tmax=avg("tmax"),
                tmin=avg("tmin"),
                rh=avg("rh"),
                rain=mean_rain,                        # 기대값(지속성)
                rain_hours=6.0 * p_rain,
                sunshine=avg("sunshine"),
                is_forecast=True,
            )
        )
        d += timedelta(days=1)
    return series
