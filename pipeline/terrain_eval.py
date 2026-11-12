"""지형 피처(DEM)가 예찰 기반 발생 예측에 도움이 되는지 연도 분리로 검증한다(분석용, 배치와 무관).

    python -m pipeline.terrain_eval --pest pepper_anthracnose

- 표본·기상 피처·직전 예찰값: pipeline/survey_train.build_samples (기존 모델과 같음)
- 지형 피처: data/reference/terrain_sigungu.csv (scripts/build_terrain_features.py) — 예찰 시군 단위
- 비교: 같은 알고리즘·하이퍼파라미터(배포 모델과 같은 RF 잎 20, XGB 깊이 3·나무 200)로 지형 피처 유무만 바꿈
- 지표: 시험 연도 AUC, 같은 회차 AUC(같은 날 시군끼리 순위 — 정적 피처가 기여할 수 있는 곳), Brier
- 결과: data/survey/eval_<pest>_terrain.json
"""
from __future__ import annotations

import argparse
import csv
import json
from datetime import date

import numpy as np

from . import config
from .survey_ml import FEATS_HIST, within_round_auc
from .survey_train import FEATURES, _years, auc, brier, build_samples

TERRAIN = ["elev_gentle", "tpi_4k_gentle", "tpi_1k_gentle", "dist_sea_km_gentle", "gentle_share", "steep_share", "relief_5k_mean", "northness_mean"]


def load_terrain() -> dict[str, list[float]]:
    p = config.DATA_DIR / "reference" / "terrain_sigungu.csv"
    out = {}
    with p.open(encoding="utf-8") as f:
        for r in csv.DictReader(f):
            out[r["key"]] = [float(r[k]) if r.get(k) not in (None, "") else np.nan for k in TERRAIN]
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pest", required=True)
    ap.add_argument("--train", default="2015-2022")
    ap.add_argument("--test", default="2023-2025")
    args = ap.parse_args(argv)
    from scipy.stats import spearmanr
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.inspection import permutation_importance
    from xgboost import XGBClassifier

    trY, teY = _years(args.train), _years(args.test)
    samples, _ = build_samples(args.pest, trY, teY, FEATS_HIST)
    terr = load_terrain()
    miss = sorted({s["sigungu"] for s in samples if s["sigungu"] not in terr})
    samples = [s for s in samples if s["sigungu"] in terr]
    print(f"표본 {len(samples)}건(지형 키 없는 시군 {len(miss)}곳 제외: {miss[:5]})")

    def mat(rows, with_terrain: bool, feats: list[str]):
        idx = [FEATS_HIST.index(f) for f in feats]
        X = [[r["x"][i] for i in idx] + (terr[r["sigungu"]] if with_terrain else []) for r in rows]
        return np.array(X, dtype=float)

    tr = [s for s in samples if s["year"] in trY]
    te = [s for s in samples if s["year"] in teY]
    ytr = np.array([s["y"] for s in tr])
    yte = [s["y"] for s in te]

    def fill(Xtr, Xte):
        m = np.nanmean(Xtr, axis=0)
        for X in (Xtr, Xte):
            i = np.where(np.isnan(X))
            X[i] = np.take(m, i[1])
        return Xtr, Xte

    res: dict = {"pest_id": args.pest, "generated": date.today().isoformat(), "train_years": args.train, "test_years": args.test,
                 "n_train": len(tr), "n_test": len(te), "terrain_features": TERRAIN, "experiments": {}}
    sets = {"기상+직전예찰": FEATS_HIST, "기상만": FEATURES}
    imp_out = {}
    for set_name, feats in sets.items():
        for algo in ("rf", "xgb"):
            for with_t in (False, True):
                Xtr, Xte = fill(mat(tr, with_t, feats), mat(te, with_t, feats))
                model = (RandomForestClassifier(random_state=0, n_jobs=-1, min_samples_leaf=20) if algo == "rf"
                         else XGBClassifier(random_state=0, eval_metric="logloss", n_jobs=4, max_depth=3, n_estimators=200))
                model.fit(Xtr, ytr)
                p = model.predict_proba(Xte)[:, 1].tolist()
                key = f"{set_name}|{algo}|{'지형 포함' if with_t else '지형 없음'}"
                res["experiments"][key] = {
                    "auc": round(auc(yte, p), 3), "within_round_auc": within_round_auc(te, p), "brier": round(brier(yte, p), 4),
                    "by_year_auc": {str(y): round(auc([s["y"] for s in te if s["year"] == y], [pp for s, pp in zip(te, p) if s["year"] == y]), 3) for y in teY},
                }
                print(key, res["experiments"][key])
                if with_t and algo == "rf":
                    pi = permutation_importance(model, Xte, np.array(yte), scoring="roc_auc", n_repeats=5, random_state=0, n_jobs=-1)
                    names = list(feats) + TERRAIN
                    imp_out[set_name] = sorted(({"feature": n, "auc_drop": round(float(m), 4)} for n, m in zip(names, pi.importances_mean)), key=lambda d: -d["auc_drop"])
    res["permutation_importance_rf"] = imp_out

    # 시군별 평균 발생률과 지형의 단순 상관(전 기간)
    by = {}
    for s in samples:
        by.setdefault(s["sigungu"], []).append(s["y"])
    keys = [k for k, v in by.items() if len(v) >= 10]
    occ = [float(np.mean(by[k])) for k in keys]
    res["sigungu_spearman"] = {}
    for j, t in enumerate(TERRAIN):
        vals = [terr[k][j] for k in keys]
        rho, pv = spearmanr(vals, occ, nan_policy="omit")
        res["sigungu_spearman"][t] = {"rho": round(float(rho), 3), "p": round(float(pv), 4)}
    res["n_sigungu_corr"] = len(keys)
    print("시군 발생률 vs 지형(스피어만):", res["sigungu_spearman"])
    out = config.DATA_DIR / "survey" / f"eval_{args.pest}_terrain.json"
    out.write_text(json.dumps(res, ensure_ascii=False, indent=2), encoding="utf-8")
    print("저장:", out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
