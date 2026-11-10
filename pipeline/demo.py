"""데모 모드: 외부 API 없이 합성 기상으로 전체 파이프라인을 돌려 화면용 데이터를 만든다.

지점 좌표는 대략적인 도시 위치(데모 표시)이며 실제 관측지점이 아니다.
"""
from __future__ import annotations

import math
import random
from datetime import date, timedelta

from models._base import DailyWeather

DEMO_SPOTS = [
    ("DEMO_SUWON", "수원(데모)", 37.27, 127.00, "경기 수원시"),
    ("DEMO_CHUNCHEON", "춘천(데모)", 37.88, 127.73, "강원 춘천시"),
    ("DEMO_GANGNEUNG", "강릉(데모)", 37.75, 128.88, "강원 강릉시"),
    ("DEMO_CHEONAN", "천안(데모)", 36.81, 127.15, "충남 천안시"),
    ("DEMO_CHEONGJU", "청주(데모)", 36.64, 127.49, "충북 청주시"),
    ("DEMO_JEONJU", "전주(데모)", 35.82, 127.15, "전북 전주시"),
    ("DEMO_NAJU", "나주(데모)", 35.02, 126.71, "전남 나주시"),
    ("DEMO_DAEGU", "대구(데모)", 35.87, 128.60, "대구 군위군"),
    ("DEMO_ANDONG", "안동(데모)", 36.57, 128.73, "경북 안동시"),
    ("DEMO_SANGJU", "상주(데모)", 36.41, 128.16, "경북 상주시"),
    ("DEMO_JINJU", "진주(데모)", 35.18, 128.11, "경남 진주시"),
    ("DEMO_JEJU", "제주(데모)", 33.50, 126.53, "제주 제주시"),
]


def demo_spots() -> list[dict]:
    return [
        {"spot_code": c, "name": n, "lat": la, "lon": lo, "altitude": 50.0, "sigungu": sg, "zone_code": ""}
        for c, n, la, lo, sg in DEMO_SPOTS
    ]


def _in(d: date, m1: int, d1: int, m2: int, d2: int) -> bool:
    return date(d.year, m1, d1) <= d <= date(d.year, m2, d2)


def synth_weather(spot: dict, start: date, end: date, issued: date, seed: int = 0) -> list[DailyWeather]:
    rng = random.Random(f"{spot['spot_code']}-{seed}")
    lat = float(spot.get("lat") or 36.0)
    out: list[DailyWeather] = []
    d = start
    wet_spell = 0
    while d <= end:
        doy = d.timetuple().tm_yday
        season = 13.0 + 13.5 * math.sin(2 * math.pi * (doy - 110) / 365.0)
        tavg = season - (lat - 36.0) * 1.1 + rng.gauss(0, 2.0)
        monsoon = _in(d, 6, 20, 7, 28) or _in(d, 8, 18, 9, 10)
        p_rain = 0.5 if monsoon else (0.28 if 5 <= d.month <= 9 else 0.2)
        if wet_spell > 0:
            p_rain = min(0.75, p_rain + 0.15)
        rain = 0.0
        if rng.random() < p_rain:
            rain = rng.expovariate(1 / (14.0 if monsoon else 6.0))
            wet_spell = 2 if monsoon else 1
        else:
            wet_spell = max(0, wet_spell - 1)
        rain = round(rain, 1)
        rain_hours = min(24.0, round(2 + rain / 3.0 + rng.random() * 3, 1)) if rain > 0 else 0.0
        rh = 58 + (22 if rain > 0 else 0) + (8 if monsoon else 0) + rng.gauss(0, 5)
        rh = max(30.0, min(99.0, rh))
        sunshine = max(0.0, (9.5 if rain == 0 else 2.5) + rng.gauss(0, 1.5))
        out.append(
            DailyWeather(
                date=d,
                tavg=round(tavg, 1),
                tmax=round(tavg + 5 + rng.random() * 2, 1),
                tmin=round(tavg - 5 - rng.random() * 2, 1),
                rh=round(rh, 1),
                rain=rain,
                rain_hours=rain_hours,
                sunshine=round(sunshine, 1),
                soil_moist=round(20 + rh / 4 + rain / 2, 1),
                is_forecast=d > issued,
            )
        )
        d += timedelta(days=1)
    return out


def demo_phenology():
    """데모용 생물계절 자료: 라이브와 같은 실제 참조 자료를 쓴다.

    기상은 합성값이지만 재배 여부는 data/reference/cultivation.csv(농업경영체 등록정보 시군 재배면적)와
    config.MIN_CULTIVATION_HA 로 판정하므로, 데모 지점의 '해당 없음 · 비재배지'는 실제 자료 기준이다.
    """
    from pipeline.phenology import load_default

    ph = load_default()
    ph.label = "실제 재배현황(data/reference) · 데모 지점·합성 기상"
    return ph


def demo_weather(spots: list[dict], issued: date, horizon: int) -> dict[str, list[DailyWeather]]:
    start = date(issued.year, 1, 1)
    end = issued + timedelta(days=horizon)
    return {s["spot_code"]: synth_weather(s, start, end, issued) for s in spots}
