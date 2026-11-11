"""예찰 학습형 여러 알고리즘(로지스틱 회귀·Random Forest·XGBoost·앙상블)을 같은 표본으로 학습·비교한다.

    python -m pipeline.survey_ml --pest pepper_anthracnose --export

- 표본·피처는 pipeline/survey_train.build_samples 와 같다(조사일 전날까지 기상 + 직전 회차 예찰값).
- 연도 분리: 학습 2015~2022, 시험 2023~2025. 시험 연도는 하이퍼파라미터 선택에 쓰지 않는다
  (학습 연도 안에서 한 해씩 빼고 검증하는 교차검증으로 고른다).
- 로지스틱 회귀는 이미 배포된 variant(survey_hist, survey_logit)의 params로 '배포와 같은 계산'을 해서 평가한다.
- 평가: AUC(전체·같은 회차), Brier, 그리고 '주의보 이상(확률 50% 이상)이면 발생'으로 볼 때의 정확도·정밀도·재현율.
- --export: models/<작물>/<병해충>/variants/survey_{rf,xgb,ens} 의 model.yaml params·학습 파일·eval.json 갱신,
  survey_hist·survey_logit 의 eval.json 도 같은 형식(정확도 포함)으로 다시 쓴다.
결과 요약: data/survey/eval_<pest>_models.json
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path
from statistics import mean

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import yaml  # noqa: E402

from pipeline import config  # noqa: E402
from pipeline.survey_train import FEATURES, WINDOW_DAYS, _years, auc, brier, build_samples, half_month  # noqa: E402,F401

FEATS_HIST = FEATURES + ["prev_survey_log"]
THRESHOLD = 0.5  # 위험지수 50(주의보) 이상 = '발생'으로 판정

# 탐색 범위(작게 유지 — 표본 약 3,400건)
RF_GRID = [{"n_estimators": 500, "min_samples_leaf": leaf, "max_features": "sqrt"} for leaf in (5, 10, 20)]
XGB_GRID = [{"n_estimators": n, "max_depth": d, "learning_rate": 0.05, "subsample": 0.8, "colsample_bytree": 0.8, "min_child_weight": 5}
            for d in (3, 4, 6) for n in (200, 400)]


def _stat_prob(params: dict, feats: dict) -> float:
    """models._base.stat.StatModel.score 와 같은 계산(z ±3 절단, 결측 피처는 0 기여)."""
    z = float(params.get("bias", 0.0))
    for spec in params.get("features", []):
        x = feats.get(spec["name"], float("nan"))
        if x is None or (isinstance(x, float) and math.isnan(x)):
            continue
        z += float(spec["weight"]) * max(-3.0, min(3.0, (x - float(spec["center"])) / max(1e-6, float(spec["scale"]))))
    return 1.0 / (1.0 + math.exp(-z))


def classification(y: list[int], p: list[float], thr: float = THRESHOLD) -> dict:
    tp = sum(1 for a, b in zip(y, p) if a == 1 and b >= thr)
    fp = sum(1 for a, b in zip(y, p) if a == 0 and b >= thr)
    fn = sum(1 for a, b in zip(y, p) if a == 1 and b < thr)
    tn = sum(1 for a, b in zip(y, p) if a == 0 and b < thr)
    n = len(y)
    prec = tp / (tp + fp) if tp + fp else None
    rec = tp / (tp + fn) if tp + fn else None
    f1 = 2 * prec * rec / (prec + rec) if prec and rec else None
    r = lambda v: None if v is None else round(v, 3)  # noqa: E731
    return {"accuracy": r((tp + tn) / n if n else None), "precision": r(prec), "recall": r(rec), "f1": r(f1),
            "confusion": {"tp": tp, "fp": fp, "fn": fn, "tn": tn}}


def within_round_auc(rows: list[dict], scores: list[float]) -> float:
    groups: dict[date, list[int]] = defaultdict(list)
    for i, r in enumerate(rows):
        groups[r["date"]].append(i)
    tot, wsum = 0.0, 0
    for idx in groups.values():
        yy = [rows[i]["y"] for i in idx]
        if 0 < sum(yy) < len(yy):
            tot += auc(yy, [scores[i] for i in idx]) * len(idx)
            wsum += len(idx)
    return round(tot / wsum, 3) if wsum else float("nan")


def year_cv(make, X, y, years) -> float:
    """학습 연도 안에서 한 해씩 빼고 검증한 평균 log loss(낮을수록 좋음)."""
    import numpy as np
    from sklearn.metrics import log_loss

    losses = []
    for yr in sorted(set(years)):
        tr, va = years != yr, years == yr
        if len(set(y[va])) < 2:
            continue
        m = make().fit(X[tr], y[tr])
        losses.append(log_loss(y[va], np.clip(m.predict_proba(X[va])[:, 1], 1e-6, 1 - 1e-6)))
    return float(np.mean(losses))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pest", required=True)
    ap.add_argument("--train", default="2015-2022")
    ap.add_argument("--test", default="2023-2025")
    ap.add_argument("--export", action="store_true", help="variants(survey_rf/xgb/ens) 파일과 eval.json 갱신")
    args = ap.parse_args(argv)

    import joblib
    import numpy as np
    from sklearn.ensemble import RandomForestClassifier
    from xgboost import XGBClassifier

    train_years, test_years = _years(args.train), _years(args.test)
    samples, skipped = build_samples(args.pest, train_years, test_years, FEATS_HIST)
    tr = [s for s in samples if s["year"] in train_years]
    te = [s for s in samples if s["year"] in test_years]

    crop, pest = _pest_folder(args.pest)
    vdir = config.MODELS_DIR / crop / pest / "variants"

    Xtr = np.array([s["x"] for s in tr], dtype=float)
    fill = np.nanmean(Xtr, axis=0)

    def mat(rows):
        X = np.array([r["x"] for r in rows], dtype=float)
        idx = np.where(np.isnan(X))
        X[idx] = np.take(fill, idx[1])
        return X

    Xtr, ytr = mat(tr), np.array([s["y"] for s in tr])
    yrs = np.array([s["year"] for s in tr])

    # --- 하이퍼파라미터(학습 연도 교차검증) ---------------------------------------
    rf_scores = [(year_cv(lambda g=g: RandomForestClassifier(random_state=0, n_jobs=-1, **g), Xtr, ytr, yrs), g) for g in RF_GRID]
    rf_best = min(rf_scores, key=lambda t: t[0])[1]
    xgb_scores = [(year_cv(lambda g=g: XGBClassifier(random_state=0, eval_metric="logloss", n_jobs=4, **g), Xtr, ytr, yrs), g) for g in XGB_GRID]
    xgb_best = min(xgb_scores, key=lambda t: t[0])[1]
    print("RF 선택:", rf_best, " XGB 선택:", xgb_best)

    rf = RandomForestClassifier(random_state=0, n_jobs=-1, **rf_best).fit(Xtr, ytr)
    xgb = XGBClassifier(random_state=0, eval_metric="logloss", n_jobs=4, **xgb_best).fit(Xtr, ytr)

    # 배포된 로지스틱 회귀(같은 계산)
    def params_of(name):
        p = vdir / name / "model.yaml"
        return yaml.safe_load(p.read_text(encoding="utf-8"))["params"] if p.exists() else None

    hist_params, logit_params = params_of("survey_hist"), params_of("survey_logit")

    def scores(rows) -> dict[str, list[float]]:
        X = mat(rows)
        out = {
            "survey_rf": [float(v) for v in rf.predict_proba(X)[:, 1]],
            "survey_xgb": [float(v) for v in xgb.predict_proba(X)[:, 1]],
        }
        if hist_params:
            out["survey_hist"] = [_stat_prob(hist_params, r["feats"]) for r in rows]
        if logit_params:
            out["survey_logit"] = [_stat_prob(logit_params, r["feats"]) for r in rows]
        members = [k for k in ("survey_hist", "survey_rf", "survey_xgb") if k in out]
        out["survey_ens"] = [mean(v) for v in zip(*(out[k] for k in members))]
        return out

    clim = {hm: mean([s["y"] for s in tr if s["hm"] == hm]) for hm in {s["hm"] for s in tr}}
    base = float(ytr.mean())

    def evaluate(rows) -> dict:
        y = [r["y"] for r in rows]
        sc = scores(rows)
        sc_base = {
            "default_rule": [((r["default"] or 0.0) / 100.0) for r in rows],
            "climatology": [clim.get(r["hm"], base) for r in rows],
            "persistence": [r["prev"] for r in rows],
        }
        res = {"n": len(rows), "positive_rate": round(mean(y), 3), "models": {}, "baselines": {}}
        for k, p in sc.items():
            res["models"][k] = {"auc": round(auc(y, p), 3), "within_round_auc": within_round_auc(rows, p),
                                "brier": round(brier(y, p), 4), **classification(y, p)}
        for k, p in sc_base.items():
            d = {"auc": round(auc(y, p), 3), "within_round_auc": 0.5 if k == "climatology" else within_round_auc(rows, p)}
            if k != "persistence":
                d.update(classification(y, p))
            if k == "climatology":
                d["brier"] = round(brier(y, p), 4)
            res["baselines"][k] = d
        return res

    result = {
        "pest_id": args.pest, "generated": date.today().isoformat(),
        "target": "시군구 예찰 조사값 > 0 (발생)", "train_years": args.train, "test_years": args.test,
        "threshold": THRESHOLD, "features": FEATS_HIST, "n_sigungu": len({s["sigungu"] for s in samples}),
        "skipped": skipped,
        "hyperparams": {"rf": rf_best, "xgb": xgb_best,
                        "rf_cv_logloss": {str(g["min_samples_leaf"]): round(v, 4) for v, g in rf_scores},
                        "xgb_cv_logloss": {f"d{g['max_depth']}_n{g['n_estimators']}": round(v, 4) for v, g in xgb_scores}},
        "test": evaluate(te),
        "test_by_year": {y: evaluate([s for s in te if s["year"] == y]) for y in test_years if any(s["year"] == y for s in te)},
        "train": evaluate(tr),
    }
    out = config.DATA_DIR / "survey" / f"eval_{args.pest}_models.json"
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    t = result["test"]
    print(f"\n시험 {t['n']}건(발생 {t['positive_rate']:.0%})  AUC / 같은회차 / 정확도 / 재현율 / 정밀도")
    for k, v in {**t["models"], **t["baselines"]}.items():
        print(f"  {k:16s} {v['auc']:.3f}  {v['within_round_auc']:.3f}  {v.get('accuracy')}  {v.get('recall')}  {v.get('precision')}")
    print(f"저장: {out}")

    if args.export:
        export(vdir, result, rf, xgb, fill.tolist(), joblib)
    return 0


def _pest_folder(pest_id: str) -> tuple[str, str]:
    from models._base.registry import discover

    m = next(m for m in discover(include_demo=False) if m.card.pest_id == pest_id and m.is_base)
    return m.folder.parent.name, m.folder.name


def _block(res: dict, key: str) -> dict:
    """eval.json 형식(화면 SurveyEvalCard 호환): '이 모델' 값은 survey_logit 키에 둔다."""
    m, b = res["models"][key], res["baselines"]
    return {
        "n": res["n"], "positive_rate": res["positive_rate"],
        "auc": {"survey_logit": m["auc"], "climatology": b["climatology"]["auc"], "default_rule": b["default_rule"]["auc"],
                "persistence": b["persistence"]["auc"]},
        "within_round_auc": {"survey_logit": m["within_round_auc"], "climatology": 0.5,
                             "default_rule": b["default_rule"]["within_round_auc"], "persistence": b["persistence"]["within_round_auc"]},
        "brier": {"survey_logit": m["brier"], "climatology": b["climatology"]["brier"]},
        "classification": {"survey_logit": {k: m[k] for k in ("accuracy", "precision", "recall", "f1")},
                           "default_rule": {k: b["default_rule"][k] for k in ("accuracy", "precision", "recall", "f1")},
                           "climatology": {k: b["climatology"][k] for k in ("accuracy", "precision", "recall", "f1")}},
    }


ALGO = {
    "survey_logit": ("로지스틱 회귀", False), "survey_hist": ("로지스틱 회귀", True),
    "survey_rf": ("Random Forest", True), "survey_xgb": ("XGBoost", True), "survey_ens": ("앙상블(로지스틱·RF·XGBoost 평균)", True),
}


def export(vdir: Path, result: dict, rf, xgb, fill: list[float], joblib) -> None:
    import sklearn
    import xgboost

    # 학습 파일
    (vdir / "survey_rf").mkdir(parents=True, exist_ok=True)
    (vdir / "survey_xgb").mkdir(parents=True, exist_ok=True)
    joblib.dump(rf, vdir / "survey_rf" / "model.joblib", compress=3)
    xgb.get_booster().save_model(str(vdir / "survey_xgb" / "model.ubj"))
    common = {"window_days": WINDOW_DAYS, "features": FEATS_HIST, "fill": [round(v, 4) for v in fill], "threshold_note": "확률×100 = 위험지수"}
    hp = result["hyperparams"]
    updates = {
        "survey_rf": {**common, "algorithm": "random_forest", "artifact": "model.joblib", "hyperparams": hp["rf"],
                      "library": f"scikit-learn {sklearn.__version__}"},
        "survey_xgb": {**common, "algorithm": "xgboost", "artifact": "model.ubj", "hyperparams": hp["xgb"],
                       "library": f"xgboost {xgboost.__version__}"},
    }
    for name, params in updates.items():
        my = vdir / name / "model.yaml"
        card = yaml.safe_load(my.read_text(encoding="utf-8"))
        spec = (card.get("params") or {}).get("survey")
        card["params"] = {**params, **({"survey": spec} if spec else {})}
        my.write_text(yaml.safe_dump(card, allow_unicode=True, sort_keys=False), encoding="utf-8")

    for key, (algo, uses_survey) in ALGO.items():
        folder = vdir / key
        if not (folder / "model.yaml").exists() or key not in result["test"]["models"]:
            continue
        card = yaml.safe_load((folder / "model.yaml").read_text(encoding="utf-8"))
        ev = {
            "model_id": card["id"], "version": card.get("version", ""), "evaluated_at": result["generated"],
            "status": "survey_evaluated", "uses_survey": uses_survey, "algorithm": algo,
            "method": f"연도 분리 검증: 학습 {result['train_years']}, 시험 {result['test_years']}. 정답 = 시군구 예찰값 > 0. "
                      f"정확도·정밀도·재현율은 위험지수 50(주의보) 이상을 '발생'으로 볼 때.",
            "n_sigungu": result["n_sigungu"], "skipped": result["skipped"],
            "test": _block(result["test"], key),
            "test_by_year": {y: _block(v, key) for y, v in result["test_by_year"].items()},
            "note": "AUC 1.0=완벽, 0.5=무작위. '같은 회차 변별력'은 같은 조사일의 시군끼리 비교한 AUC로, 계절(시기) 효과를 뺀 성능입니다.",
        }
        if key in ("survey_rf", "survey_xgb"):
            ev["hyperparams"] = hp["rf" if key == "survey_rf" else "xgb"]
        (folder / "eval.json").write_text(json.dumps(ev, ensure_ascii=False, indent=2), encoding="utf-8")
        print("내보냄:", folder)


if __name__ == "__main__":
    raise SystemExit(main())
