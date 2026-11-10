"""유형 C(통계·ML) 모델 학습 템플릿.

예찰조사(정답)와 과거 기상(피처)을 붙여 로지스틱 회귀 계수를 구하고,
그 계수를 model.yaml의 params.features(center/scale/weight)와 bias로 옮겨 적는 흐름이다.
LightGBM 등 비선형 모델을 쓰려면 model.py에서 predict()를 재정의해 pickle을 읽도록 바꾼다.

실행: python -m pipeline.train_template --pest rice_sheath_blight
(scikit-learn 필요: pip install scikit-learn)
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from models._base.stat import compute_features  # noqa: E402
from pipeline import config  # noqa: E402
from pipeline.backtest import load_cached_weather  # noqa: E402

FEATURES = ["tavg_30d", "tmin_7d", "rh_30d", "rain_30d", "rain_days_30d", "sunshine_7d"]


def build_dataset(pest_id: str, survey_csv: Path) -> tuple[list[list[float]], list[int]]:
    X: list[list[float]] = []
    y: list[int] = []
    with survey_csv.open(encoding="utf-8") as f:
        rows = [r for r in csv.DictReader(f) if r.get("pest_id") == pest_id]
    by_spot_year: dict[tuple[str, int], list[dict]] = {}
    for r in rows:
        d = datetime.strptime(r["survey_date"][:10], "%Y-%m-%d").date()
        by_spot_year.setdefault((r["spot_code"], d.year), []).append({"date": d, "occurred": int(float(r.get("occurred", 0)))})
    for (code, year), obs in by_spot_year.items():
        wx = sorted(load_cached_weather(code, year), key=lambda w: w.date)
        if not wx:
            continue
        idx = {w.date: i for i, w in enumerate(wx)}
        for o in obs:
            i = idx.get(o["date"])
            if i is None or i < 7:
                continue
            feats = compute_features(wx[max(0, i - 29): i + 1])
            X.append([float(feats.get(k) or 0.0) for k in FEATURES])
            y.append(o["occurred"])
    return X, y


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pest", required=True)
    ap.add_argument("--survey", default=str(config.DATA_DIR / "survey" / "survey.csv"))
    args = ap.parse_args(argv)
    X, y = build_dataset(args.pest, Path(args.survey))
    if len(X) < 30:
        print(f"학습 표본이 {len(X)}개뿐입니다(최소 30). 예찰조사와 기상 캐시를 확인하세요.")
        return 2
    try:
        import numpy as np
        from sklearn.linear_model import LogisticRegression
        from sklearn.preprocessing import StandardScaler
    except ImportError:
        print("scikit-learn 이 필요합니다: pip install scikit-learn")
        return 2
    Xa, ya = np.array(X), np.array(y)
    sc = StandardScaler().fit(Xa)
    clf = LogisticRegression(max_iter=1000).fit(sc.transform(Xa), ya)
    features = [
        {"name": n, "center": round(float(m), 2), "scale": round(float(s), 2), "weight": round(float(w), 3)}
        for n, m, s, w in zip(FEATURES, sc.mean_, sc.scale_, clf.coef_[0])
    ]
    out = {"window_days": 30, "bias": round(float(clf.intercept_[0]), 3), "features": features, "n_samples": int(len(ya)), "positive_rate": round(float(ya.mean()), 3)}
    print(json.dumps(out, ensure_ascii=False, indent=2))
    print("\n위 값을 model.yaml의 params에 옮겨 적고 PR을 올리면 백테스트가 자동 실행됩니다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
