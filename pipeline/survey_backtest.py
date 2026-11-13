"""과거 예찰 회차로 '되돌려 보기' 자료를 만든다 — 그날 모델이 낸 위험지수와 실제 예찰값을 시군별로 나란히.

    python -m pipeline.survey_backtest --pest pepper_anthracnose

- 표본·피처는 pipeline/survey_train.build_samples 와 같다(조사일 전날까지 기상 + 같은 해 직전 회차 예찰값).
- 점수는 지금 배포된 모델 파일(variants/*)을 그대로 읽어 계산한다(재학습하지 않음).
- 결과: data/backtest/<pest>.json (커밋) → 배치 publish 가 apps/web/public/data/backtest/ 로 복사.
- 학습 연도(기본 2015~2022) 회차는 모델이 이미 본 자료라 '참고용'으로 표시한다. 정직한 비교는 시험 연도(2023~2025).
"""
from __future__ import annotations

import argparse
import csv
import json
import math
from collections import defaultdict
from datetime import date

import yaml

from models._base.registry import discover

from . import config
from .survey_ml import FEATS_HIST, THRESHOLD, _pest_folder, _stat_prob
from .survey_train import _years, build_samples

OUT_DIR = config.DATA_DIR / "backtest"


def _centroids() -> dict[str, tuple[float, float]]:
    p = config.DATA_DIR / "reference" / "sigungu_centroids.csv"
    out: dict[str, tuple[float, float]] = {}
    if p.exists():
        with p.open(encoding="utf-8") as f:
            for r in csv.DictReader(f):
                try:
                    out[r["key"]] = (round(float(r["lat"]), 4), round(float(r["lon"]), 4))
                except (TypeError, ValueError):
                    pass
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pest", required=True)
    ap.add_argument("--train", default="2015-2022")
    ap.add_argument("--test", default="2023-2025")
    args = ap.parse_args(argv)

    import joblib
    import numpy as np
    from xgboost import XGBClassifier

    train_years, test_years = _years(args.train), _years(args.test)
    crop, pest = _pest_folder(args.pest)
    vdir = config.MODELS_DIR / crop / pest / "variants"

    def params(name):
        p = vdir / name / "model.yaml"
        return yaml.safe_load(p.read_text(encoding="utf-8"))["params"] if p.exists() else None

    rf_p, xgb_p = params("survey_rf"), params("survey_xgb")
    feats = list(rf_p.get("features") or FEATS_HIST)  # 배포 모델과 같은 피처(지형 sgg_·ASOS a_ 포함)
    samples, _ = build_samples(args.pest, train_years, test_years, feats)
    from . import asos

    if asos.uses_asos(feats):
        asos.attach(samples)
        for s in samples:
            s["x"] = [s["feats"].get(k, float("nan")) for k in feats]
    rf = joblib.load(vdir / "survey_rf" / rf_p["artifact"])
    xgb = XGBClassifier()
    xgb.load_model(str(vdir / "survey_xgb" / xgb_p["artifact"]))
    fill = np.array(rf_p["fill"], dtype=float)
    X = np.array([s["x"] for s in samples], dtype=float)
    idx = np.where(np.isnan(X))
    X[idx] = np.take(fill, idx[1])

    sc: dict[str, list[float]] = {
        "survey_rf": [float(v) for v in rf.predict_proba(X)[:, 1]],
        "survey_xgb": [float(v) for v in xgb.predict_proba(X)[:, 1]],
    }
    for name in ("survey_hist", "survey_logit"):
        p = params(name)
        if p:
            sc[name] = [_stat_prob(p, s["feats"]) for s in samples]
    members = [k for k in ("survey_hist", "survey_rf", "survey_xgb") if k in sc]
    sc["survey_ens"] = [sum(v) / len(v) for v in zip(*(sc[k] for k in members))]
    sc["default"] = [((s["default"] or 0.0) / 100.0) for s in samples]

    loaded = {m.id: m for m in discover() if m.card.pest_id == args.pest}
    ids = {k: (f"{args.pest}__{k}" if k != "default" else args.pest) for k in sc}
    models = [
        {"key": k, "model_id": ids[k], "label": loaded[ids[k]].label if ids[k] in loaded else k,
         "is_default": bool(ids[k] in loaded and loaded[ids[k]].is_default)}
        for k in ["survey_ens", "survey_rf", "survey_xgb", "survey_hist", "survey_logit", "default"] if k in sc
    ]

    cents = _centroids()
    rounds: dict[str, list] = defaultdict(list)
    for i, s in enumerate(samples):
        rounds[s["date"].isoformat()].append({
            "sigungu": s["sigungu"],
            "loc": cents.get(s["sigungu"]),
            "actual": round(float(s["value"]), 2),
            "prev": round(float(s["prev"]), 2),
            "wx_km": round(float(s["wx_km"]), 1),
            "pred": {m["key"]: round(100.0 * sc[m["key"]][i], 1) for m in models},
        })
    out = {
        "pest_id": args.pest,
        "generated": date.today().isoformat(),
        "target": "시군구 예찰 피해과율(%) — 0보다 크면 '발생'",
        "threshold_index": round(THRESHOLD * 100),
        "train_years": train_years,
        "test_years": test_years,
        "models": models,
        "rounds": [
            {"date": d, "year": int(d[:4]), "split": "test" if int(d[:4]) in test_years else "train",
             "rows": sorted(rows, key=lambda r: -r["actual"])}
            for d, rows in sorted(rounds.items())
        ],
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / f"{args.pest}.json"
    path.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    n_test = sum(len(r["rows"]) for r in out["rounds"] if r["split"] == "test")
    print(f"저장: {path} · 회차 {len(out['rounds'])}개, 표본 {len(samples)}건(시험 연도 {n_test}건)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
