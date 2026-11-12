"""시군 토양 면적 분포(data/reference/soil_stats_raw.json, scripts/fetch_soil_stats.py) → 시군 토양 피처 CSV.

    python scripts/build_soil_features.py

출력: data/reference/soil_sigungu.csv (key + 아래 피처). 면적은 ha, '기타(etc_Area)'는 분모에서 뺀다.
등급 항목은 응답의 면적 필드 순서가 코드표 순서(1등급→)와 같다(data/reference/soil_codes.json 으로 확인).
  soil_drain_idx        배수등급 평균(1 매우양호 ~ 6 매우불량)
  soil_drain_poor       배수 약간불량·불량·매우불량 면적 비율
  soil_depth_idx        유효토심 평균(1 매우얕음 0–25cm ~ 4 깊음 100cm 이상)
  soil_depth_shallow    유효토심 50cm 미만 면적 비율
  soil_texture_idx      표토토성 평균(1 양질조사토 … 9 식양토, 클수록 고운 흙)
  soil_texture_sandy    사토 계열(1~3) 면적 비율
  soil_slope_idx        경사 등급 평균(응답 필드 순서 = 완경사 → 급경사)
  soil_field_good       밭 적성 1·2급지 비율
  soil_fruit_good       과수상전 적성 1·2급지 비율
  soil_paddy_good       논 적성 1·2급지 비율
  soil_land_paddy / soil_land_field / soil_land_orchard   주토지이용 논·밭·과수상전 면적 비율
"""
from __future__ import annotations

import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "reference" / "soil_stats_raw.json"
OUT = ROOT / "data" / "reference" / "soil_sigungu.csv"


def classes(rec: dict | None) -> list[float]:
    if not rec:
        return []
    return [v for k, v in rec.items() if k != "etc_Area"]


def mean_idx(vals: list[float]) -> float | None:
    s = sum(vals)
    return round(sum((i + 1) * v for i, v in enumerate(vals)) / s, 3) if s > 0 else None


def share(vals: list[float], idx: list[int]) -> float | None:
    s = sum(vals)
    return round(sum(vals[i] for i in idx if i < len(vals)) / s, 4) if s > 0 else None


def main() -> int:
    raw = json.loads(RAW.read_text(encoding="utf-8"))
    rows = []
    for key, r in sorted(raw.items()):
        d, dep, tx, sl = classes(r.get("drain")), classes(r.get("depth")), classes(r.get("texture")), classes(r.get("slope"))
        fg, frg, pg, lu = classes(r.get("field_grade")), classes(r.get("fruit_grade")), classes(r.get("paddy_grade")), classes(r.get("landuse"))
        rows.append({
            "key": key,
            "soil_drain_idx": mean_idx(d), "soil_drain_poor": share(d, [3, 4, 5]),
            "soil_depth_idx": mean_idx(dep), "soil_depth_shallow": share(dep, [0, 1]),
            "soil_texture_idx": mean_idx(tx), "soil_texture_sandy": share(tx, [0, 1, 2]),
            "soil_slope_idx": mean_idx(sl),
            "soil_field_good": share(fg, [0, 1]), "soil_fruit_good": share(frg, [0, 1]), "soil_paddy_good": share(pg, [0, 1]),
            "soil_land_paddy": share(lu, [0]), "soil_land_field": share(lu, [1]), "soil_land_orchard": share(lu, [2]),
        })
    with OUT.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    print(f"저장: {OUT} ({len(rows)}개 시군)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
