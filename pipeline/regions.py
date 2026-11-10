"""시군 단위 짝짓기 — 관측소·예찰이 없는 시군은 '가장 가까운 시군'으로 대체.

키 형식은 '시도 시군'(예: '경기 이천시', phenology.region_key와 같음).

- 기상: 시군에 관측소가 있으면 그 시군 관측소(여럿이면 평균), 없으면 관측소가 있는 시군 중 가장 가까운 곳
- 예찰: 지점(관측소)의 시군이 예찰 대상이면 그 시군 값, 아니면 예찰이 있는 시군 중 지점에서 가장 가까운 곳

대체는 매번 그때 있는 자료로 다시 계산한다. 나중에 그 시군에 관측소·예찰이 생기면 자동으로 자기 자료를 쓴다.
거리는 시군 대표 좌표(data/reference/sigungu_centroids.csv, OSM Nominatim) 사이의 대권거리(km).
"""
from __future__ import annotations

import csv
import math
from dataclasses import dataclass
from functools import lru_cache
from typing import Iterable, Optional

from . import config
from .phenology import norm_sido, region_key

CENTROIDS_CSV = config.REFERENCE_DIR / "sigungu_centroids.csv"
STATIONS_CSV = config.REFERENCE_DIR / "agri_stations.csv"

# 관측소 설치 주소가 옛 행정구역명으로 남은 경우 → 현재 시군
# 여주군→여주시(2013.9 시 승격), 당진군→당진시(2012.1 시 승격), 청원군→청주시(2014.7 통합)
ADMIN_RENAMES = {"여주군": "여주시", "당진군": "당진시", "청원군": "청주시"}
# 시도가 바뀐 시군: 군위군 경북→대구(2023.7 편입)
KEY_RENAMES = {"경북 군위군": "대구 군위군"}
SIDOS = {"서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종", "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주"}


def key_of(sido: str, sigungu: str) -> str:
    sg = ADMIN_RENAMES.get((sigungu or "").strip(), (sigungu or "").strip())
    key = f"{norm_sido(sido)} {sg}"
    return KEY_RENAMES.get(key, key)


def key_from_address(address: str) -> str:
    """'경기도 이천시 …' → '경기 이천시'. 시도가 빠진 주소('나주시 봉황면 …')는 시군 이름으로 시도를 찾는다."""
    parts = (address or "").split()
    if not parts:
        return ""
    if norm_sido(parts[0]) not in SIDOS:
        sg = ADMIN_RENAMES.get(parts[0], parts[0])
        sidos = {k.split(" ", 1)[0] for k in centroids() if k.split(" ", 1)[1] == sg}
        if len(sidos) != 1:
            return ""
        key = f"{next(iter(sidos))} {sg}"
        return KEY_RENAMES.get(key, key)
    sd, sg = region_key(address)
    return key_of(sd, sg) if sd and sg else ""


def haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    (la1, lo1), (la2, lo2) = a, b
    p1, p2 = math.radians(la1), math.radians(la2)
    dp, dl = p2 - p1, math.radians(lo2 - lo1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(h))


@lru_cache(maxsize=1)
def centroids() -> dict[str, tuple[float, float]]:
    out: dict[str, tuple[float, float]] = {}
    if CENTROIDS_CSV.exists():
        with CENTROIDS_CSV.open(encoding="utf-8") as f:
            for r in csv.DictReader(f):
                out[r["key"]] = (float(r["lat"]), float(r["lon"]))
    return out


@lru_cache(maxsize=1)
def stations() -> dict[str, dict]:
    """관측소 코드 → {key, lat, lon, name}. 관측지점 상세정보 설치 주소 기준."""
    out: dict[str, dict] = {}
    if STATIONS_CSV.exists():
        with STATIONS_CSV.open(encoding="utf-8") as f:
            for r in csv.DictReader(f):
                k = key_from_address(r["address"])
                try:
                    lat, lon = float(r["lat"]), float(r["lon"])
                except ValueError:
                    lat = lon = None
                out[r["spot_code"]] = {"key": k, "lat": lat, "lon": lon, "name": r["name"]}
    return out


def location_of(key: str, fallback_points: Optional[list[tuple[float, float]]] = None) -> Optional[tuple[float, float]]:
    """시군 대표 좌표. 표에 없으면 주어진 점, 그것도 없으면 그 시군 관측소들의 평균 좌표."""
    c = centroids().get(key)
    if c:
        return c
    pts = [p for p in (fallback_points or []) if p and p[0] is not None]
    if not pts:
        pts = [(st["lat"], st["lon"]) for st in stations().values() if st["key"] == key and st["lat"] is not None]
    if pts:
        return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
    return None


@dataclass(frozen=True)
class Source:
    key: str            # 자료를 가져온 시군
    distance_km: float  # 대상과의 거리(자기 시군이면 0)

    @property
    def substituted(self) -> bool:
        return self.distance_km > 0


def nearest(target: tuple[float, float], candidates: dict[str, tuple[float, float]]) -> Optional[Source]:
    best: Optional[Source] = None
    for k, loc in candidates.items():
        d = haversine_km(target, loc)
        if best is None or d < best.distance_km:
            best = Source(k, round(d, 1))
    return best


def resolve(target_key: str, available: Iterable[str], target_loc: Optional[tuple[float, float]] = None,
            available_locs: Optional[dict[str, tuple[float, float]]] = None) -> Optional[Source]:
    """target 시군에 자료가 있으면 자기 자신, 없으면 자료가 있는 시군 중 가장 가까운 곳."""
    avail = set(available)
    if target_key in avail:
        return Source(target_key, 0.0)
    loc = target_loc or location_of(target_key)
    if loc is None:
        return None
    locs = {}
    for k in avail:
        p = (available_locs or {}).get(k) or location_of(k)
        if p:
            locs[k] = p
    return nearest(loc, locs)
