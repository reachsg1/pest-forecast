"""병해충별 연도별 발생 추이 — NCPMS 시군 예찰 조사값(scripts/fetch_survey.py 결과 CSV)을 연도·회차별로 요약한다.

    python -m pipeline.survey_trend            # 자료가 있는 병해충 모두

- 입력: data/survey/ncpms_<pest_id>_sigungu.csv (조사 항목은 아래 ITEMS의 정확한 이름만 사용)
- 출력: data/trend/<pest_id>.json (커밋) → 배치 publish 가 apps/web/public/data/trend/ 로 복사
- '발생'은 조사값 > 0. 시군 수·회차 수가 해마다 다르므로 평균값과 함께 조사 규모를 같이 싣는다.
"""
from __future__ import annotations

import csv
import json
from collections import defaultdict
from datetime import date
from statistics import mean

from . import config

# pest_id → (NCPMS 조사 항목 정확한 이름, 화면 단위 설명)
ITEMS: dict[str, tuple[str, str]] = {
    "pepper_anthracnose": ("탄저병(피해과율)", "피해과율(%)"),
    "pepper_phytophthora": ("역병(피해주율)", "피해주율(%)"),
    "pepper_oriental_tobacco_budworm": ("담배나방(피해과율)", "피해과율(%)"),
    "apple_anthracnose": ("탄저병(피해과율)", "피해과율(%)"),
    "apple_oriental_fruit_moth": ("복숭아순나방(피해과율)", "피해과율(%)"),
    # 벼: 항목 이름 확인 후 추가(scripts/fetch_survey.py --predictn 00204 --crop FC010101 --examin 01322)
}

SRC = config.DATA_DIR / "survey"
OUT = config.DATA_DIR / "trend"


def _num(v) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def build(pest_id: str) -> dict | None:
    item, unit = ITEMS[pest_id]
    path = SRC / f"ncpms_{pest_id}_sigungu.csv"
    if not path.exists():
        return None
    rows = []
    with path.open(encoding="utf-8") as f:
        for r in csv.DictReader(f):
            v = _num(r.get("value"))
            if r.get("item") != item or v is None or not r.get("sigungu"):
                continue
            rows.append({"year": int(r["year"]), "date": r["survey_date"], "sgg": f"{r['sido']} {r['sigungu']}", "v": v})
    if not rows:
        return None
    by_year: dict[int, list[dict]] = defaultdict(list)
    for r in rows:
        by_year[r["year"]].append(r)

    years = []
    for y in sorted(by_year):
        rs = by_year[y]
        by_date: dict[str, list[float]] = defaultdict(list)
        for r in rs:
            by_date[r["date"]].append(r["v"])
        rounds = [
            {"date": d, "n": len(vs), "mean": round(mean(vs), 3), "occ_rate": round(sum(v > 0 for v in vs) / len(vs), 3), "max": max(vs)}
            for d, vs in sorted(by_date.items())
        ]
        sgg_max: dict[str, float] = defaultdict(float)
        for r in rs:
            sgg_max[r["sgg"]] = max(sgg_max[r["sgg"]], r["v"])
        peak = max(rounds, key=lambda x: (x["mean"], x["occ_rate"]))
        years.append({
            "year": y,
            "n_records": len(rs),
            "n_rounds": len(rounds),
            "n_sigungu": len(sgg_max),
            "mean": round(mean(r["v"] for r in rs), 3),
            "occ_rate": round(sum(r["v"] > 0 for r in rs) / len(rs), 3),
            # 그해 한 번이라도 발생한 시군 비율
            "sgg_occ_rate": round(sum(v > 0 for v in sgg_max.values()) / len(sgg_max), 3),
            "max": max(r["v"] for r in rs),
            "peak_date": peak["date"],
            "top_sigungu": [{"sigungu": k, "max": v} for k, v in sorted(sgg_max.items(), key=lambda kv: -kv[1])[:5] if v > 0],
            "rounds": rounds,
        })
    return {
        "pest_id": pest_id,
        "generated": date.today().isoformat(),
        "source": "NCPMS 병해충 예찰 OpenAPI(SVC51~53) 시군구 조사값",
        "item": item,
        "unit": unit,
        "occurrence": "조사값 0 초과",
        "years": years,
    }


def main(argv: list[str] | None = None) -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    for pid in ITEMS:
        doc = build(pid)
        if doc is None:
            print(f"{pid}: 자료 없음(건너뜀)")
            continue
        (OUT / f"{pid}.json").write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        ys = [y["year"] for y in doc["years"]]
        print(f"{pid}: {ys[0]}~{ys[-1]}년 {len(ys)}개 연도 · 조사 {sum(y['n_records'] for y in doc['years'])}건")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
