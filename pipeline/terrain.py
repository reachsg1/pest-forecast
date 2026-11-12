"""지형 피처(정적) — 모든 모델이 이름으로 꺼내 쓰는 공통 피처. 병해충 발생과 작물 생육 모두에 쓴다.

자료: data/reference/terrain_spots.csv, terrain_sigungu.csv (scripts/build_terrain_features.py, 국토지리정보원 90m DEM)

피처 이름(모델 params.features 에 그대로 적어 쓴다):
  관측지점(site_)  — 지점 좌표의 90m 격자 값
    site_elev, site_slope, site_northness, site_eastness, site_tpi_1k, site_tpi_4k, site_relief_5k, site_dist_sea_km
  지점이 속한 시군의 재배지 요약(sgg_) — 시군 경계 안 완경사지(경사 7도 미만) 통계
    sgg_elev_gentle, sgg_tpi_1k_gentle, sgg_tpi_4k_gentle, sgg_dist_sea_km_gentle,
    sgg_gentle_share, sgg_steep_share, sgg_relief_5k_mean, sgg_northness_mean, sgg_elev_mean
  생육 관련 파생
    site_lapse_dt — 관측지점 고도 → 시군 재배지 평균 고도로 옮길 때의 기온 보정(℃) = −0.0065 × (sgg_elev_gentle − site_elev)
                   (기온 감률 6.5℃/km: 국제표준대기 ISO 2533 대류권 평균. 실제 감률은 계절·날씨에 따라 다름)

예찰(시군 단위) 학습 표본에는 sgg_ 피처만 있다(관측지점이 정해지지 않음). 지점 실행 때는 둘 다 넘긴다.
"""
from __future__ import annotations

import csv
import math
from functools import lru_cache

from . import config

LAPSE_C_PER_M = 0.0065

SITE_COLS = ["elev", "slope", "northness", "eastness", "tpi_1k", "tpi_4k", "relief_5k", "dist_sea_km"]
SGG_COLS = ["elev_gentle", "tpi_1k_gentle", "tpi_4k_gentle", "dist_sea_km_gentle", "gentle_share", "steep_share",
            "relief_5k_mean", "northness_mean", "elev_mean"]
SOURCE = "국토지리정보원 한반도 수치표고모델 90m"


def _num(v):
    try:
        x = float(v)
        return x if math.isfinite(x) else None
    except (TypeError, ValueError):
        return None


@lru_cache(maxsize=1)
def _spots() -> dict[str, dict]:
    p = config.DATA_DIR / "reference" / "terrain_spots.csv"
    if not p.exists():
        return {}
    with p.open(encoding="utf-8") as f:
        return {r["spot_code"]: r for r in csv.DictReader(f)}


@lru_cache(maxsize=1)
def _sgg() -> dict[str, dict]:
    p = config.DATA_DIR / "reference" / "terrain_sigungu.csv"
    if not p.exists():
        return {}
    with p.open(encoding="utf-8") as f:
        return {r["key"]: r for r in csv.DictReader(f)}


def sgg_features(key: str) -> dict[str, float]:
    """시군 키('경기 이천시') → sgg_ 피처. 없으면 빈 사전(모델은 결측으로 처리)."""
    r = _sgg().get(key)
    if not r:
        return {}
    return {f"sgg_{c}": v for c in SGG_COLS if (v := _num(r.get(c))) is not None}


def spot_features(spot_code: str) -> dict[str, float]:
    """관측지점 → site_ + (그 지점 시군의) sgg_ + 파생 피처."""
    r = _spots().get(spot_code)
    if not r:
        return {}
    out = {f"site_{c}": v for c in SITE_COLS if (v := _num(r.get(c))) is not None}
    out.update(sgg_features(r.get("sgg_key", "")))
    if "site_elev" in out and "sgg_elev_gentle" in out:
        out["site_lapse_dt"] = round(-LAPSE_C_PER_M * (out["sgg_elev_gentle"] - out["site_elev"]), 2)
    return out


def spot_sgg_key(spot_code: str) -> str:
    return (_spots().get(spot_code) or {}).get("sgg_key", "")


_DIRS = ["북", "북동", "동", "남동", "남", "남서", "서", "북서"]


def describe(spot_code: str) -> dict | None:
    """화면 표시용 요약(지점 패널): 고도·경사·사면 방향·지형 위치·바다 거리·재배지 고도 보정."""
    f = spot_features(spot_code)
    if not f:
        return None
    aspect = None
    n, e = f.get("site_northness"), f.get("site_eastness")
    if n is not None and e is not None and (f.get("site_slope") or 0) >= 1.0:
        deg = (math.degrees(math.atan2(e, n)) + 360) % 360
        aspect = _DIRS[int((deg + 22.5) // 45) % 8]
    tpi = f.get("site_tpi_1k")
    pos = None
    if tpi is not None:
        pos = "주변보다 낮은 곳(골짜기·분지)" if tpi <= -10 else "주변보다 높은 곳(능선·언덕)" if tpi >= 10 else "주변과 비슷한 높이"
    return {
        "elev": f.get("site_elev"),
        "slope": f.get("site_slope"),
        "aspect": aspect,
        "position": pos,
        "tpi_1k": tpi,
        "dist_sea_km": f.get("site_dist_sea_km"),
        "sgg_key": spot_sgg_key(spot_code),
        "sgg_elev_gentle": f.get("sgg_elev_gentle"),
        "lapse_dt": f.get("site_lapse_dt"),
        "source": SOURCE,
    }
