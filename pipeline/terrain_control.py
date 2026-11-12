"""지형 피처 효과의 대조 실험(분석용): 지형이 '시군 이름표'(그 시군의 평소 발생률) 이상의 정보를 주는가?

    python -m pipeline.terrain_control --pest <pest_id> [--train 2015-2022 --test 2023-2025]

1) 연도 분리(학습 연도 → 시험 연도), RF(잎 20)로 네 가지 비교
   A 기본(기상+직전예찰) / B +지형 / C +시군 평소 발생률(학습 연도 평균, 이름표 대조군) / D +발생률+지형
   - B ≈ C 이고 D ≈ C 면 지형은 사실상 시군 이름표 역할
   - D > C 면 지형이 이름표 이상의 정보(예: 지형 조건 자체)를 준다
2) 처음 보는 시군(시군 묶음 5겹 교차검증, 기상만): 이름표를 쓸 수 없는 상황에서 지형이 일반화되는가
결과: data/survey/eval_<pest>_terrain_control.json
"""
from __future__ import annotations

import argparse
import json
from datetime import date

import numpy as np

from . import config
from .survey_ml import FEATS_HIST, within_round_auc
from .survey_train import FEATURES, _years, auc, build_samples
from .terrain_eval import load_terrain


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pest", required=True)
    ap.add_argument("--train", default="2015-2022")
    ap.add_argument("--test", default="2023-2025")
    args = ap.parse_args(argv)
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.model_selection import GroupKFold

    trY, teY = _years(args.train), _years(args.test)
    S, _ = build_samples(args.pest, trY, teY, FEATS_HIST)
    T = load_terrain()
    S = [s for s in S if s["sigungu"] in T]
    tr = [s for s in S if s["year"] in trY]
    te = [s for s in S if s["year"] in teY]
    rate: dict[str, list[int]] = {}
    for s in tr:
        rate.setdefault(s["sigungu"], []).append(s["y"])
    base = float(np.mean([s["y"] for s in tr]))
    srate = {k: float(np.mean(v)) for k, v in rate.items()}

    def M(rows, feats, terrain=False, sgg=False):
        idx = [FEATS_HIST.index(f) for f in feats]
        A = np.array([[r["x"][i] for i in idx] + (T[r["sigungu"]] if terrain else []) + ([srate.get(r["sigungu"], base)] if sgg else []) for r in rows], float)
        return A

    def fit_eval(Atr, Ate):
        m = np.nanmean(Atr, 0)
        for A in (Atr, Ate):
            i = np.where(np.isnan(A))
            A[i] = np.take(m, i[1])
        p = RandomForestClassifier(random_state=0, n_jobs=-1, min_samples_leaf=20).fit(Atr, np.array([s["y"] for s in tr])).predict_proba(Ate)[:, 1].tolist()
        y = [s["y"] for s in te]
        return {"auc": round(auc(y, p), 3), "within_round_auc": within_round_auc(te, p)}

    res = {"pest_id": args.pest, "generated": date.today().isoformat(), "train_years": args.train, "test_years": args.test,
           "n_train": len(tr), "n_test": len(te), "n_sigungu": len({s["sigungu"] for s in S}),
           "test_sigungu_unseen_in_train": len({s["sigungu"] for s in te} - set(srate)), "year_split": {}}
    for name, feats in (("기상+직전예찰", FEATS_HIST), ("기상만", FEATURES)):
        res["year_split"][name] = {
            "A_기본": fit_eval(M(tr, feats), M(te, feats)),
            "B_지형": fit_eval(M(tr, feats, terrain=True), M(te, feats, terrain=True)),
            "C_시군발생률": fit_eval(M(tr, feats, sgg=True), M(te, feats, sgg=True)),
            "D_발생률+지형": fit_eval(M(tr, feats, True, True), M(te, feats, True, True)),
        }
    # 처음 보는 시군: 기상만 vs 기상+지형 (연도 섞임, 시군 묶음 교차검증)
    y = np.array([s["y"] for s in S])
    g = [s["sigungu"] for s in S]
    k = min(5, len(set(g)))
    unseen = {}
    for terr in (False, True):
        A = M(S, FEATURES, terrain=terr)
        m = np.nanmean(A, 0)
        i = np.where(np.isnan(A))
        A[i] = np.take(m, i[1])
        P = np.zeros(len(S))
        for a, b in GroupKFold(k).split(A, y, g):
            P[b] = RandomForestClassifier(random_state=0, n_jobs=-1, min_samples_leaf=20).fit(A[a], y[a]).predict_proba(A[b])[:, 1]
        unseen["기상+지형" if terr else "기상만"] = {"auc": round(auc(y.tolist(), P.tolist()), 3), "within_round_auc": within_round_auc(S, P.tolist())}
    res["unseen_sigungu"] = unseen
    out = config.DATA_DIR / "survey" / f"eval_{args.pest}_terrain_control.json"
    out.write_text(json.dumps(res, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(res, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
