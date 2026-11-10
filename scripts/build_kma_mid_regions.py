"""기상청 중기예보 구역표 — 지점을 가장 가까운 중기기온 도시와 그 육상예보 구역에 짝짓기 위한 표.

    python scripts/build_kma_mid_regions.py

- 기온 구역(getMidTa regId)과 도시명: 기상청 날씨누리 중기예보 화면(www.weather.go.kr/w/forecast/overall/mid-term.do)의
  도시별 그래프 링크(FCT_WI1_<regId>_…png, data-alt=도시명)에서 읽는다(38개 도시).
- 육상예보 구역(getMidLandFcst regId): 기온 구역 코드 앞자리 규칙(11B→11B00000, 11D1→11D10000 …)으로 정한다.
  ※ 중기예보 API 승인 후 실호출로 각 육상 구역이 응답하는지 확인할 것(울릉도 11E는 경북 11H10000로 둠 — 확인 필요).
- 좌표: data/reference/sigungu_centroids.csv 에서 '<도시>시/군'을 찾고, 없으면(광역시 등) OSM Nominatim으로 찾는다.
- 결과: data/reference/kma_mid_regions.csv (ta_reg_id, city, land_reg_id, land_name, lat, lon)
"""
from __future__ import annotations

import csv
import json
import re
import sys
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pipeline import config  # noqa: E402

PAGE = "https://www.weather.go.kr/w/forecast/overall/mid-term.do"
UA_BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
UA_GEO = "pest-forecast-pipeline/0.1 (public pest forecast research)"

# 육상 구역(기온 구역 코드 앞자리 → 육상 regId, 이름)
LAND = [
    ("11B", "11B00000", "서울·인천·경기"),
    ("11D1", "11D10000", "강원 영서"),
    ("11D2", "11D20000", "강원 영동"),
    ("11C2", "11C20000", "대전·세종·충남"),
    ("11C1", "11C10000", "충북"),
    ("11F2", "11F20000", "광주·전남"),
    ("11F1", "11F10000", "전북"),
    ("11H1", "11H10000", "대구·경북"),
    ("11H2", "11H20000", "부산·울산·경남"),
    ("11G", "11G00000", "제주"),
    ("11E", "11H10000", "대구·경북(울릉도, 확인 필요)"),
]


# 육상 구역 → 속한 시도(좌표를 고를 때 동명 시군을 거르기 위함: 광주(광역시) ≠ 경기 광주시)
LAND_SIDOS = {
    "11B": {"서울", "인천", "경기"}, "11D": {"강원"}, "11C2": {"대전", "세종", "충남"}, "11C1": {"충북"},
    "11F2": {"광주", "전남"}, "11F1": {"전북"}, "11H1": {"대구", "경북"}, "11H2": {"부산", "울산", "경남"},
    "11G": {"제주"}, "11E": {"경북"},
}
METRO = {"서울": "서울특별시", "인천": "인천광역시", "대전": "대전광역시", "광주": "광주광역시", "부산": "부산광역시",
         "울산": "울산광역시", "대구": "대구광역시", "세종": "세종특별자치시", "울릉도": "울릉군"}


def sidos_of(ta: str) -> set[str]:
    for pre, sds in sorted(LAND_SIDOS.items(), key=lambda x: -len(x[0])):
        if ta.startswith(pre):
            return sds
    return set()


def land_of(ta: str) -> tuple[str, str]:
    for pre, reg, name in LAND:
        if ta.startswith(pre):
            return reg, name
    return "", ""


def city_codes() -> list[tuple[str, str]]:
    r = requests.get(PAGE, headers={"User-Agent": UA_BROWSER, "Accept-Language": "ko-KR,ko;q=0.9"}, timeout=30)
    r.raise_for_status()
    r.encoding = "utf-8"
    pairs = re.findall(r'FCT_WI1_(1[12][A-H]\d{5})_\d{12}\.png"[^>]*data-alt="([^"]+)"', r.text)
    seen, out = set(), []
    for code, name in pairs:
        if code not in seen:
            seen.add(code)
            out.append((code, name))
    return out


def coords(city: str, sidos: set[str]) -> tuple[float, float, str] | None:
    with (config.REFERENCE_DIR / "sigungu_centroids.csv").open(encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    for suffix in ("시", "군"):
        hit = [r for r in rows if r["sigungu"] == city + suffix and r["sido"] in sidos]
        if len(hit) == 1:
            return float(hit[0]["lat"]), float(hit[0]["lon"]), f"sigungu_centroids:{hit[0]['key']}"
    cache = config.CACHE_DIR / "geocode" / f"_mid_{city}.json"
    if cache.exists():
        g = json.loads(cache.read_text(encoding="utf-8"))
    else:
        time.sleep(1.1)
        r = requests.get("https://nominatim.openstreetmap.org/search",
                         params={"q": METRO.get(city, city), "format": "jsonv2", "limit": 5, "countrycodes": "kr"}, headers={"User-Agent": UA_GEO}, timeout=30)
        r.raise_for_status()
        c = [x for x in r.json() if x.get("type") == "administrative" or x.get("addresstype") in {"city", "county", "island", "state"}]
        g = {"lat": float(c[0]["lat"]), "lon": float(c[0]["lon"]), "display_name": c[0]["display_name"]} if c else None
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps(g, ensure_ascii=False), encoding="utf-8")
    return (g["lat"], g["lon"], "OSM Nominatim: " + g["display_name"]) if g else None


def main() -> int:
    rows, missing = [], []
    for code, city in city_codes():
        c = coords(city, sidos_of(code))
        if not c:
            missing.append(city)
            continue
        land, lname = land_of(code)
        rows.append({"ta_reg_id": code, "city": city, "land_reg_id": land, "land_name": lname,
                     "lat": round(c[0], 5), "lon": round(c[1], 5), "coord_source": c[2]})
    out = config.REFERENCE_DIR / "kma_mid_regions.csv"
    with out.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    print(f"{len(rows)}개 도시 → {out}")
    if missing:
        print("좌표 못 찾음:", ", ".join(missing))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
