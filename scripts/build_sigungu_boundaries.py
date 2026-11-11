"""시군 경계(예측 지도 시군별 색 표시용)를 만든다 — 행정동 경계를 시군 단위로 합치고 가볍게 줄인다.

    python scripts/build_sigungu_boundaries.py [--src data/cache/boundary/HangJeongDong_ver20261001.geojson]

원자료: vuski/admdongkor 행정동 경계(https://github.com/vuski/admdongkor, CC BY 4.0)
        ← 통계청 통계지리정보서비스(SGIS) 행정동 경계, 공공누리 제1유형(출처표시)
원본 파일(약 35MB)은 data/cache/boundary/ 에 두고(git 제외) 결과만 커밋한다:
        apps/web/public/geo/sigungu.json  (GeoJSON, 속성 key·name·lat·lon)
키는 pipeline/regions.key_of 규칙('시도약칭 시군')과 같다. 일반구(수원시 장안구 등)는 시로 합친다.
경계 판은 최신 행정구역(2026 전남광주통합특별시·인천 구 개편 반영)이라 옛 이름을 쓰는 지점 주소와 다를 수 있다
→ 웹은 지점 좌표가 어느 경계 안에 있는지로 시군을 정한다(주소 키 아님).
필요 패키지: shapely>=2 (배치 실행에는 필요 없음, 경계를 다시 만들 때만)
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pipeline import regions  # noqa: E402

DEFAULT_SRC = ROOT / "data" / "cache" / "boundary" / "HangJeongDong_ver20261001.geojson"
OUT = ROOT / "apps" / "web" / "public" / "geo" / "sigungu.json"
ATTRIBUTION = (
    "통계청 통계지리정보서비스(SGIS) 행정동 경계(공공누리 제1유형)를 가공한 vuski/admdongkor(CC BY 4.0)를 "
    "시군 단위로 합쳐 단순화"
)
GU = re.compile(r"^(.+?시)(.+구)$")  # 수원시장안구 → 수원시


def _round(geom, nd: int = 4):
    from shapely import set_precision

    return set_precision(geom, 10 ** -nd)


def main(argv: list[str] | None = None) -> int:
    from shapely.geometry import mapping, shape
    from shapely.ops import unary_union

    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=str(DEFAULT_SRC))
    ap.add_argument("--tolerance", type=float, default=0.004, help="단순화 허용오차(도, 0.004 ≈ 400m)")
    args = ap.parse_args(argv)

    src = json.loads(Path(args.src).read_text(encoding="utf-8"))
    parts: dict[str, list] = defaultdict(list)
    names: dict[str, str] = {}
    for f in src["features"]:
        p = f["properties"]
        sgg = p.get("sggnm") or ""
        m = GU.match(sgg)
        sgg = m.group(1) if m else sgg
        sido = p.get("sidonm", "")
        if sido.startswith("전남광주"):
            # 2026 전남·광주 통합: 자치구(○○구)는 옛 광주, 시·군은 옛 전남 — 예찰·관측 자료의 시도 이름과 맞춘다
            sido = "광주광역시" if sgg.endswith("구") else "전라남도"
        key = regions.key_of(sido, sgg)
        parts[key].append(shape(f["geometry"]).buffer(0))
        names[key] = sgg

    feats = []
    for key, geoms in sorted(parts.items()):
        g = unary_union(geoms).simplify(args.tolerance, preserve_topology=True)
        g = _round(g)
        if g.is_empty:
            continue
        c = g.representative_point()
        feats.append({
            "type": "Feature",
            "properties": {"key": key, "name": names[key], "lat": round(c.y, 4), "lon": round(c.x, 4)},
            "geometry": mapping(g),
        })
    out = {"type": "FeatureCollection", "attribution": ATTRIBUTION, "source_version": Path(args.src).stem, "features": feats}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"저장: {OUT} · 시군 {len(feats)}개 · {OUT.stat().st_size / 1e6:.2f}MB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
