"""기상청 단기·중기예보(공공데이터포털) 수집과 예보 연장.

- 단기예보(VilageFcstInfoService_2.0): 발표시각 기준 약 3일치 시간별 예보 → 일별 집계
- 중기예보(MidFcstInfoService): 3(또는 4)~10일 뒤 도시별 최저·최고기온(getMidTa)과 육상 구역별
  오전·오후 날씨·강수확률(getMidLandFcst). 지점은 가장 가까운 중기기온 도시와 그 육상 구역으로 짝짓는다
  (data/reference/kma_mid_regions.csv). 같은 구역은 실행 중 한 번만 호출한다.
- 두 예보 모두 없는 날은 지속성(최근 14일 평균)으로 채운다. 모두 is_forecast=True.

강수 처리: 중기예보는 강수량을 주지 않는다. 기상청 예보 날씨(wf)에 비·눈·소나기가 있으면 '비 오는 날'로 보고
최근 30일 비 온 날(≥1mm)의 평균 강수량을 넣는다(없으면 1mm). 그 외는 0. 지속성 구간도 최근 14일 중 절반 이상
비가 왔을 때만 비 오는 날로 둔다(평균 강수를 매일 나눠 넣으면 '매일 약한 비'가 되는 문제 방지).
"""
from __future__ import annotations

import csv
import logging
import math
import re
from collections import defaultdict
from dataclasses import dataclass
from functools import lru_cache
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


# --- 중기예보 ----------------------------------------------------------------
WET_WORDS = ("비", "눈", "소나기")


@dataclass
class MidDay:
    """중기예보 하루치(도시 기온 + 육상 구역 날씨)."""

    date: date
    tmin: Optional[float]
    tmax: Optional[float]
    rain_prob: Optional[float]  # 오전·오후 중 큰 값(%)
    wf: str                     # 예보 날씨 문구(오전/오후)

    @property
    def wet(self) -> bool:
        return any(w in self.wf for w in WET_WORDS)


def latest_mid_tmfc(now: Optional[datetime] = None) -> str:
    """가장 최근 중기예보 발표시각(06시·18시, 발표 직후 30분 여유)."""
    now = (now or datetime.now()) - timedelta(minutes=30)
    if now.hour >= 18:
        return now.strftime("%Y%m%d") + "1800"
    if now.hour >= 6:
        return now.strftime("%Y%m%d") + "0600"
    return (now - timedelta(days=1)).strftime("%Y%m%d") + "1800"


def _mid_item(key: str, url: str, reg_id: str, tmfc: str) -> dict:
    r = get(url, {"serviceKey": key, "pageNo": 1, "numOfRows": 10, "dataType": "JSON", "regId": reg_id, "tmFc": tmfc})
    try:
        items = r.json()["response"]["body"]["items"]["item"]
    except (ValueError, KeyError) as e:
        raise RuntimeError(f"중기예보 응답 해석 실패({reg_id}): {r.text[:300]}") from e
    return items[0] if isinstance(items, list) else items


def _num(v) -> Optional[float]:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def parse_mid(ta: dict, land: dict, tmfc: str) -> list[MidDay]:
    """getMidTa·getMidLandFcst 응답 → n일 뒤(3~10) MidDay.
    필드: taMin{n}/taMax{n}, rnSt{n}Am/Pm(8일 이후는 rnSt{n}), wf{n}Am/Pm(8일 이후는 wf{n})."""
    base = datetime.strptime(tmfc[:8], "%Y%m%d").date()
    out: list[MidDay] = []
    for n in range(3, 11):
        tmin, tmax = _num(ta.get(f"taMin{n}")), _num(ta.get(f"taMax{n}"))
        probs = [x for x in (_num(land.get(f"rnSt{n}Am")), _num(land.get(f"rnSt{n}Pm")), _num(land.get(f"rnSt{n}"))) if x is not None]
        wf = " / ".join(x for x in (land.get(f"wf{n}Am"), land.get(f"wf{n}Pm"), land.get(f"wf{n}")) if x)
        if tmin is None and tmax is None and not probs and not wf:
            continue
        out.append(MidDay(date=base + timedelta(days=n), tmin=tmin, tmax=tmax, rain_prob=max(probs) if probs else None, wf=wf))
    return out


@lru_cache(maxsize=1)
def mid_regions() -> list[dict]:
    p = config.REFERENCE_DIR / "kma_mid_regions.csv"
    if not p.exists():
        return []
    with p.open(encoding="utf-8") as f:
        return [{**r, "lat": float(r["lat"]), "lon": float(r["lon"])} for r in csv.DictReader(f)]


def nearest_mid_region(lat: float, lon: float) -> Optional[dict]:
    """가장 가까운 중기기온 도시(구면 거리)."""
    best, best_d = None, None
    for r in mid_regions():
        p1, p2 = math.radians(lat), math.radians(r["lat"])
        dl = math.radians(r["lon"] - lon)
        c = math.sin(p1) * math.sin(p2) + math.cos(p1) * math.cos(p2) * math.cos(dl)
        d = math.acos(max(-1.0, min(1.0, c))) * 6371.0
        if best_d is None or d < best_d:
            best, best_d = r, d
    return {**best, "distance_km": round(best_d, 1)} if best else None


class MidForecaster:
    """실행 1회 동안 구역별 응답을 재사용한다(호출 수 = 쓰인 기온 도시 수 + 육상 구역 수, 최대 48)."""

    def __init__(self, key: str, tmfc: Optional[str] = None):
        self.key = key
        self.tmfc = tmfc or latest_mid_tmfc()
        self._ta: dict[str, dict] = {}
        self._land: dict[str, dict] = {}

    def for_point(self, lat: float, lon: float) -> tuple[list[MidDay], Optional[dict]]:
        reg = nearest_mid_region(lat, lon)
        if not reg:
            return [], None
        if reg["ta_reg_id"] not in self._ta:
            self._ta[reg["ta_reg_id"]] = _mid_item(self.key, config.KMA_MID_TA, reg["ta_reg_id"], self.tmfc)
        if reg["land_reg_id"] not in self._land:
            self._land[reg["land_reg_id"]] = _mid_item(self.key, config.KMA_MID_LAND, reg["land_reg_id"], self.tmfc)
        return parse_mid(self._ta[reg["ta_reg_id"]], self._land[reg["land_reg_id"]], self.tmfc), reg


def _wet_day_rain(recent: list[DailyWeather]) -> float:
    """비 오는 날로 볼 때 넣을 강수량: 최근 비 온 날(≥1mm) 평균, 없으면 1mm(강수일로만 셈)."""
    wet = [w.rain for w in recent if (w.rain or 0) >= 1.0]
    return round(mean(wet), 1) if wet else 1.0


def extend_forecast(observed: list[DailyWeather], forecast: list[DailyWeather], until: date,
                    mid: Optional[list[MidDay]] = None) -> list[DailyWeather]:
    """단기예보 이후 날짜를 중기예보(있으면)와 지속성(최근 14일 평균)으로 채운다."""
    series = sorted(observed + forecast, key=lambda w: w.date)
    if not series:
        return []
    obs_only = [w for w in series if not w.is_forecast]
    recent = obs_only[-14:] or series[-14:]
    recent30 = obs_only[-30:] or series[-30:]

    def avg(attr: str) -> Optional[float]:
        vals = [getattr(w, attr) for w in recent if getattr(w, attr) is not None]
        return mean(vals) if vals else None

    wet_rain = _wet_day_rain(recent30)
    p_rain = sum(1 for w in recent if (w.rain or 0) >= 1.0) / len(recent) if recent else 0.0
    mid_by_day = {m.date: m for m in (mid or [])}
    d = series[-1].date + timedelta(days=1)
    while d <= until:
        m = mid_by_day.get(d)
        if m is not None:
            tmin = m.tmin if m.tmin is not None else avg("tmin")
            tmax = m.tmax if m.tmax is not None else avg("tmax")
            tavg = (tmin + tmax) / 2.0 if tmin is not None and tmax is not None else avg("tavg")
            wet = m.wet
        else:
            tmin, tmax, tavg = avg("tmin"), avg("tmax"), avg("tavg")
            wet = p_rain >= 0.5
        series.append(DailyWeather(
            date=d, tavg=tavg, tmax=tmax, tmin=tmin, rh=avg("rh"),
            rain=wet_rain if wet else 0.0, rain_hours=6.0 if wet else 0.0,
            sunshine=avg("sunshine"), is_forecast=True,
        ))
        d += timedelta(days=1)
    return series
