"""시군 대표 좌표 표 — 관측소·예찰이 없는 시군을 '가장 가까운 시군'으로 대체할 때 쓴다.

    python scripts/fetch_sigungu_centroids.py

- 대상: data/reference/cultivation.csv 의 시군(209곳) + 예찰 수집본(data/survey/ncpms_*_sigungu.csv)의 시군
- 좌표: OpenStreetMap Nominatim 행정구역 검색 결과의 대표점(대개 행정 중심). © OpenStreetMap contributors, ODbL
- Nominatim 이용 정책에 따라 1초에 1건, 결과는 data/cache/geocode/ 에 캐시
- 결과: data/reference/sigungu_centroids.csv (key, sido, sigungu, lat, lon, source)
"""
from __future__ import annotations

import csv
import glob
import json
import sys
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pipeline import config  # noqa: E402
from pipeline.phenology import norm_sido  # noqa: E402

URL = "https://nominatim.openstreetmap.org/search"
UA = "pest-forecast-pipeline/0.1 (public pest forecast research)"
CACHE = config.CACHE_DIR / "geocode"

# Nominatim 검색어용 시도 정식 명칭(통합·개칭 전후 모두 같은 지역으로 찾기 위해)
SIDO_QUERY = {
    "서울": "서울특별시", "부산": "부산광역시", "대구": "대구광역시", "인천": "인천광역시", "광주": "광주광역시",
    "대전": "대전광역시", "울산": "울산광역시", "세종": "세종특별자치시", "경기": "경기도", "강원": "강원특별자치도",
    "충북": "충청북도", "충남": "충청남도", "전북": "전북특별자치도", "전남": "전라남도", "경북": "경상북도",
    "경남": "경상남도", "제주": "제주특별자치도",
}


def targets() -> list[tuple[str, str]]:
    out: set[tuple[str, str]] = set()
    with (config.REFERENCE_DIR / "cultivation.csv").open(encoding="utf-8") as f:
        for r in csv.DictReader(f):
            out.add((norm_sido(r["sido"]), r["sigungu"]))
    for p in glob.glob(str(config.DATA_DIR / "survey" / "ncpms_*_sigungu.csv")):
        with open(p, encoding="utf-8") as f:
            for r in csv.DictReader(f):
                if r.get("sigungu"):
                    out.add((norm_sido(r["sido"]), r["sigungu"]))
    return sorted(out)


def geocode(sido: str, sigungu: str) -> dict | None:
    cp = CACHE / f"{sido}_{sigungu}.json"
    if cp.exists():
        return json.loads(cp.read_text(encoding="utf-8"))
    res = None
    for q in (f"{SIDO_QUERY.get(sido, sido)} {sigungu}", f"{sigungu}"):
        time.sleep(1.1)
        r = requests.get(URL, params={"q": q, "format": "jsonv2", "limit": 5, "countrycodes": "kr"}, headers={"User-Agent": UA}, timeout=30)
        r.raise_for_status()
        cands = [c for c in r.json() if c.get("type") == "administrative" or c.get("addresstype") in {"city", "county", "borough", "town"}]
        cands = [c for c in cands if sigungu in c.get("display_name", "")]
        if cands:
            c = cands[0]
            res = {"lat": float(c["lat"]), "lon": float(c["lon"]), "display_name": c["display_name"]}
            break
    CACHE.mkdir(parents=True, exist_ok=True)
    cp.write_text(json.dumps(res, ensure_ascii=False), encoding="utf-8")
    return res


def main() -> int:
    rows, missing = [], []
    for sido, sgg in targets():
        g = geocode(sido, sgg)
        if not g:
            missing.append(f"{sido} {sgg}")
            continue
        rows.append({"key": f"{sido} {sgg}", "sido": sido, "sigungu": sgg, "lat": round(g["lat"], 5), "lon": round(g["lon"], 5),
                     "source": "OpenStreetMap Nominatim(ODbL): " + g["display_name"]})
    out = config.REFERENCE_DIR / "sigungu_centroids.csv"
    with out.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["key", "sido", "sigungu", "lat", "lon", "source"])
        w.writeheader()
        w.writerows(rows)
    print(f"{len(rows)}곳 → {out}")
    if missing:
        print("좌표 못 찾음:", ", ".join(missing))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
