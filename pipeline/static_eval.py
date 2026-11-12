"""정적 환경 피처(지형·토양)가 예찰 기반 발생 예측에 주는 효과를 한 번에 비교한다(분석용, 배치와 무관).

    python -m pipeline.static_eval --pest <pest_id> [--train 2015-2022 --test 2023-2025]

- 표본: survey_train.build_samples (기상 + 직전 예찰). 지형: data/reference/terrain_sigungu.csv, 토양: soil_sigungu.csv
- 연도 분리, Random Forest(잎 최소 20 — 배포 모델과 같음)
  A 기본 / T +지형 / S +토양 / TS +지형+토양 / C +시군 평소 발생률(이름표 대조군)
- 처음 보는 시군(시군 묶음 5겹 교차검증, 기상만): 기본 / +지형 / +토양 / +지형+토양
- 지표: 전체 AUC, 같은 회차 AUC(같은 날 시군 간 순위)
결과: data/survey/eval_<pest>_static.json
"""
from __future__ import annotations

import argparse
import csv
import json
from datetime import date

import numpy as np

from . import config
from .survey_ml import FEATS_HIST, within_round_auc
from .survey_train import FEATURES, _years, auc, build_samples
from .terrain_eval import load_terrain


def load_soil() -> tuple[dict[str, list[float]], list[str]]:
    p = config.DATA_DIR / "reference" / "soil_sigungu.csv"
    with p.open(encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    names = [k for k in rows[0] if k != "key"]
    return {r["key"]: [float(r[k]) if r[k] not in ("", None) else np.nan for k in names] for r in rows}, names


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pest", required=True)
    ap.add_argument("--train", default="2015-2022")
    ap.add_argument("--test", default="2023-2025")
    args = ap.parse_args(argv)
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.inspection import permutation_importance
    from sklearn.model_selection import GroupKFold

    trY, teY = _years(args.train), _years(args.test)
    S, _ = build_samples(args.pest, trY, teY, FEATS_HIST)
    T = load_terrain()
    SOIL, soil_names = load_soil()
    nT, nS = len(next(iter(T.values()))), len(soil_names)
    keep = [s for s in S if s["sigungu"] in T]
    no_soil = sorted({s["sigungu"] for s in keep if s["sigungu"] not in SOIL})
    S = keep
    tr = [s for s in S if s["year"] in trY]
    te = [s for s in S if s["year"] in teY]
    rate: dict[str, list[int]] = {}
    for s in tr:
        rate.setdefault(s["sigungu"], []).append(s["y"])
    base = float(np.mean([s["y"] for s in tr]))
    srate = {k: float(np.mean(v)) for k, v in rate.items()}

    def M(rows, feats, t=False, so=False, c=False):
        idx = [FEATS_HIST.index(f) for f in feats]
        return np.array([[r["x"][i] for i in idx]
                         + (T[r["sigungu"]] if t else [])
                         + ((SOIL.get(r["sigungu"]) or [np.nan] * nS) if so else [])
                         + ([srate.get(r["sigungu"], base)] if c else []) for r in rows], float)

    def impute(Atr, Ate):
        m = np.nanmean(Atr, 0)
        m = np.where(np.isnan(m), 0.0, m)
        for A in (Atr, Ate):
            i = np.where(np.isnan(A))
            A[i] = np.take(m, i[1])
        return Atr, Ate

    ytr = np.array([s["y"] for s in tr])
    yte = [s["y"] for s in te]
    res = {"pest_id": args.pest, "generated": date.today().isoformat(), "train_years": args.train, "test_years": args.test,
           "n_train": len(tr), "n_test": len(te), "n_sigungu": len({s["sigungu"] for s in S}), "sigungu_without_soil": no_soil,
           "soil_features": soil_names, "year_split": {}, "unseen_sigungu": {}}
    groups = {"A_기본": {}, "T_지형": {"t": True}, "S_토양": {"so": True}, "TS_지형+토양": {"t": True, "so": True}, "C_시군발생률": {"c": True}}
    for set_name, feats in (("기상+직전예찰", FEATS_HIST), ("기상만", FEATURES)):
        res["year_split"][set_name] = {}
        for g, kw in groups.items():
            Atr, Ate = impute(M(tr, feats, **kw), M(te, feats, **kw))
            model = RandomForestClassifier(random_state=0, n_jobs=-1, min_samples_leaf=20).fit(Atr, ytr)
            p = model.predict_proba(Ate)[:, 1].tolist()
            res["year_split"][set_name][g] = {"auc": round(auc(yte, p), 3), "within_round_auc": within_round_auc(te, p)}
            if set_name == "기상+직전예찰" and g == "TS_지형+토양":
                pi = permutation_importance(model, Ate, np.array(yte), scoring="roc_auc", n_repeats=5, random_state=0, n_jobs=-1)
                names = list(feats) + [f"terrain:{i}" for i in range(nT)] + soil_names
                res["permutation_importance_TS"] = sorted(({"feature": n, "auc_drop": round(float(v), 4)} for n, v in zip(names, pi.importances_mean)), key=lambda d: -d["auc_drop"])[:15]
    y = np.array([s["y"] for s in S])
    gids = [s["sigungu"] for s in S]
    k = min(5, len(set(gids)))
    for g, kw in {"기상만": {}, "+지형": {"t": True}, "+토양": {"so": True}, "+지형+토양": {"t": True, "so": True}}.items():
        A = M(S, FEATURES, **kw)
        P = np.zeros(len(S))
        for a, b in GroupKFold(k).split(A, y, gids):
            Atr, Ate = impute(A[a].copy(), A[b].copy())
            P[b] = RandomForestClassifier(random_state=0, n_jobs=-1, min_samples_leaf=20).fit(Atr, y[a]).predict_proba(Ate)[:, 1]
        res["unseen_sigungu"][g] = {"auc": round(auc(y.tolist(), P.tolist()), 3), "within_round_auc": within_round_auc(S, P.tolist())}
    out = config.DATA_DIR / "survey" / f"eval_{args.pest}_static.json"
    out.write_text(json.dumps(res, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: res[k] for k in ("pest_id", "n_train", "n_test", "n_sigungu", "sigungu_without_soil", "year_split", "unseen_sigungu")}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
