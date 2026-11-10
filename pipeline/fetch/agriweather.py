"""국립농업과학원 농업기상(농업날씨365) 오픈API 수집.

- 관측지점 목록: getObsrSpotList
- 일별 관측(월 단위): WeatherObsrInfo/V2/GnrlWeather/getWeatherMonDayList
개발계정 일일 트래픽(1,000건)을 고려해 지점×월 단위로 호출하고 data/cache에 저장한다.
"""
from __future__ import annotations

import json
import logging
from datetime import date, datetime
from pathlib import Path
from typing import Optional

from models._base import DailyWeather

from .. import config
from .http import get, pick, to_float, xml_header, xml_items

log = logging.getLogger(__name__)


def _parse_date(s: Optional[str]) -> Optional[date]:
    if not s:
        return None
    s = s.strip().replace(".", "-").replace("/", "-")
    for fmt in ("%Y-%m-%d", "%Y%m%d", "%Y-%m-%d %H:%M", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(s[:19] if " " in s else s, fmt).date()
        except ValueError:
            continue
    return None


def fetch_spots(key: str) -> list[dict]:
    """관측지점 마스터. 반환: [{spot_code, name, lat, lon, altitude, sigungu, zone_code, raw}]"""
    spots: list[dict] = []
    page = 1
    while True:
        r = get(config.AGRI_SPOT_LIST, {"serviceKey": key, "Page_No": page, "Page_Size": config.AGRI_PAGE_SIZE})
        items = xml_items(r.text)
        if not items:
            hdr = xml_header(r.text)
            if page == 1:
                log.warning("관측지점 응답에 item 없음: %s", hdr or r.text[:300])
            break
        for it in items:
            code = pick(it, config.FIELD_CANDIDATES["spot_code"])
            if not code:
                continue
            spots.append(
                {
                    "spot_code": code,
                    "name": pick(it, config.FIELD_CANDIDATES["spot_name"]) or code,
                    "lat": to_float(pick(it, config.FIELD_CANDIDATES["lat"])),
                    "lon": to_float(pick(it, config.FIELD_CANDIDATES["lon"])),
                    "altitude": to_float(pick(it, config.FIELD_CANDIDATES["altitude"])),
                    "sigungu": pick(it, config.FIELD_CANDIDATES["sigungu"]) or "",
                    "zone_code": pick(it, config.FIELD_CANDIDATES["zone_code"]) or "",
                    "raw": it,
                }
            )
        if len(items) < config.AGRI_PAGE_SIZE:
            break
        page += 1
    return spots


def _cache_path(spot_code: str, year: int, month: int) -> Path:
    return config.CACHE_DIR / "agriweather" / spot_code / f"{year:04d}-{month:02d}.json"


def fetch_month_daily(key: str, spot_code: str, year: int, month: int, *, use_cache: bool = True) -> list[dict]:
    """지점·월별 일자료(원시 태그 사전 목록). 지난 달은 캐시하고 이번 달은 매번 새로 받는다."""
    today = date.today()
    is_past_month = (year, month) < (today.year, today.month)
    cp = _cache_path(spot_code, year, month)
    if use_cache and is_past_month and cp.exists():
        return json.loads(cp.read_text(encoding="utf-8"))
    rows: list[dict] = []
    page = 1
    while True:
        r = get(
            config.AGRI_DAILY_MONTH,
            {
                "serviceKey": key,
                "Page_No": page,
                "Page_Size": config.AGRI_PAGE_SIZE,
                "search_Year": f"{year:04d}",
                "search_Month": f"{month:02d}",
                "obsr_Spot_Cd": spot_code,
            },
        )
        items = xml_items(r.text)
        if not items:
            if page == 1:
                log.debug("%s %04d-%02d: item 없음 (%s)", spot_code, year, month, xml_header(r.text))
            break
        rows.extend(items)
        if len(items) < config.AGRI_PAGE_SIZE:
            break
        page += 1
    if is_past_month and rows:
        cp.parent.mkdir(parents=True, exist_ok=True)
        cp.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
    return rows


def to_daily_weather(raw_rows: list[dict]) -> list[DailyWeather]:
    """원시 태그 사전 → DailyWeather. 태그명은 config.FIELD_CANDIDATES로 매핑."""
    fc = config.FIELD_CANDIDATES
    out: list[DailyWeather] = []
    for it in raw_rows:
        d = _parse_date(pick(it, fc["date"]))
        if d is None:
            continue
        # condens_Time(결로시간)은 '분' 단위(2024-07 전국 최대 1,433 ≈ 24h, 11-10 확인) → 시간으로 환산
        condens_min = to_float(pick(it, fc["condens_hours"]))
        condens = None if condens_min is None else round(min(condens_min, 1440.0) / 60.0, 2)
        out.append(
            DailyWeather(
                date=d,
                tavg=to_float(pick(it, fc["tavg"])),
                tmax=to_float(pick(it, fc["tmax"])),
                tmin=to_float(pick(it, fc["tmin"])),
                rh=to_float(pick(it, fc["rh"])),
                rain=to_float(pick(it, fc["rain"])),
                lwd_hours=condens,
                sunshine=to_float(pick(it, fc["sunshine"])),
                radiation=to_float(pick(it, fc["radiation"])),
                wind=to_float(pick(it, fc["wind"])),
                soil_moist=to_float(pick(it, fc["soil_moist"])),
            )
        )
    out.sort(key=lambda w: w.date)
    # 같은 날짜 중복 제거(마지막 값 유지)
    dedup: dict[date, DailyWeather] = {w.date: w for w in out}
    return [dedup[k] for k in sorted(dedup)]


def fetch_range_daily(key: str, spot_code: str, start: date, end: date) -> list[DailyWeather]:
    """start~end 기간의 일자료를 월 단위 호출로 모은다."""
    rows: list[dict] = []
    y, m = start.year, start.month
    while (y, m) <= (end.year, end.month):
        try:
            rows.extend(fetch_month_daily(key, spot_code, y, m))
        except Exception as e:  # noqa: BLE001
            log.warning("%s %04d-%02d 수집 실패: %s", spot_code, y, m, e)
        m += 1
        if m > 12:
            m, y = 1, y + 1
    return [w for w in to_daily_weather(rows) if start <= w.date <= end]


def fetch_month_all(key: str, year: int, month: int, *, use_cache: bool = True) -> list[dict]:
    """전국 전 지점의 월별 일자료(원시 태그 사전). 학습용 과거자료 수집에 쓴다 — 월 1회 호출.

    지난 달은 data/cache/agriweather/_all/YYYY-MM.json 에 캐시한다.
    """
    today = date.today()
    is_past_month = (year, month) < (today.year, today.month)
    cp = config.CACHE_DIR / "agriweather" / "_all" / f"{year:04d}-{month:02d}.json"
    if use_cache and is_past_month and cp.exists():
        return json.loads(cp.read_text(encoding="utf-8"))
    rows: list[dict] = []
    page = 1
    while True:
        r = get(
            config.AGRI_DAILY_MONTH,
            {"serviceKey": key, "Page_No": page, "Page_Size": config.AGRI_PAGE_SIZE_BULK,
             "search_Year": f"{year:04d}", "search_Month": f"{month:02d}"},
            timeout=120,
        )
        items = xml_items(r.text)
        if not items:
            if page == 1:
                log.warning("%04d-%02d 전국 일자료 없음 (%s)", year, month, xml_header(r.text))
            break
        rows.extend(items)
        if len(items) < config.AGRI_PAGE_SIZE_BULK:
            break
        page += 1
    if is_past_month and rows:
        cp.parent.mkdir(parents=True, exist_ok=True)
        cp.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
    return rows


def probe(key: str, spot_code: Optional[str] = None) -> str:
    """응답 원문을 확인하기 위한 진단 호출. 태그명을 FIELD_CANDIDATES에 반영할 때 쓴다."""
    out = []
    r = get(config.AGRI_SPOT_LIST, {"serviceKey": key, "Page_No": 1, "Page_Size": 2})
    out.append("=== getObsrSpotList (앞 1,500자) ===\n" + r.text[:1500])
    items = xml_items(r.text)
    code = spot_code or (pick(items[0], config.FIELD_CANDIDATES["spot_code"]) if items else None)
    if code:
        today = date.today()
        r2 = get(
            config.AGRI_DAILY_MONTH,
            {"serviceKey": key, "Page_No": 1, "Page_Size": 2, "search_Year": today.year, "search_Month": f"{today.month:02d}", "obsr_Spot_Cd": code},
        )
        out.append(f"=== getWeatherMonDayList spot={code} (앞 2,000자) ===\n" + r2.text[:2000])
    return "\n\n".join(out)
