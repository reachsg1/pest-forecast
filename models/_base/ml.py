"""유형 D — 학습한 기계학습 모델(Random Forest·XGBoost)을 그대로 실행한다.

model.yaml params:
    algorithm: random_forest | xgboost
    artifact: model.joblib | model.ubj   (variant 폴더 안, pipeline/survey_ml.py --export 가 만든다)
    features: [피처 이름 …]              (학습 때와 같은 순서)
    fill: [결측 대체값 …]                 (학습 표본 평균)
    window_days: 150
    survey: {kncr, examin, item}          (prev_survey_log 피처를 쓰면 배치가 예찰 이력을 history로 넘긴다)

피처 계산은 models._base.stat.compute_features 와 같고, prev_survey_log 는 StatModel 과 같은 규칙
(그날 이전·같은 해 최신 예찰값, 아직 조사 전이면 0)이다. 위험지수 = 발생 확률 × 100.
"""
from __future__ import annotations

import math
from pathlib import Path
from typing import Optional, Sequence

from .interface import BaseModel, DailyWeather, RiskPoint, clamp
from .stat import compute_features, survey_asof

# 지점 패널 서술형 안내에 쓸 주요 기상 피처
EXPLAIN = ("rain_14d", "rain_days_14d", "lwd_14d", "tavg_14d", "rh_14d")


class MLModel(BaseModel):
    type_code = "D"

    _model = None

    def _folder(self) -> Path:
        return Path(self.card.path) if self.card.path else Path(".")

    def _load(self):
        if self._model is not None:
            return self._model
        algo = self.params.get("algorithm")
        path = self._folder() / str(self.params.get("artifact", ""))
        if algo == "random_forest":
            import joblib

            self._model = joblib.load(path)
        elif algo == "xgboost":
            from xgboost import XGBClassifier

            m = XGBClassifier()
            m.load_model(str(path))
            self._model = m
        else:
            raise ValueError(f"알 수 없는 algorithm: {algo}")
        return self._model

    def predict(self, weather: Sequence[DailyWeather], history: Optional[list] = None) -> list[RiskPoint]:
        import numpy as np

        names: list[str] = list(self.params.get("features", []))
        fill: list[float] = list(self.params.get("fill", [0.0] * len(names)))
        n = int(self.params.get("window_days", 150))
        seq = sorted(weather, key=lambda x: x.date)
        if not seq:
            return []
        rows, details = [], []
        for i, w in enumerate(seq):
            feats = compute_features(seq[max(0, i - n + 1): i + 1])
            ref = survey_asof(history, w.date)
            feats["prev_survey_log"] = math.log1p(max(0.0, float(ref["value"]))) if ref else 0.0
            x = []
            for j, k in enumerate(names):
                v = feats.get(k, float("nan"))
                x.append(fill[j] if v is None or (isinstance(v, float) and math.isnan(v)) else float(v))
            rows.append(x)
            d = {k: round(feats[k], 1) for k in EXPLAIN if isinstance(feats.get(k), float) and not math.isnan(feats[k])}
            if "prev_survey_log" in names:
                if history is None:
                    d["survey_missing"] = True
                elif ref:
                    d["survey_ref"] = {"date": ref["date"].isoformat(), "value": ref["value"],
                                       "sigungu": ref.get("sigungu", ""), "distance_km": ref.get("distance_km", 0.0)}
            details.append(d)
        probs = self._load().predict_proba(np.array(rows, dtype=float))[:, 1]
        out: list[RiskPoint] = []
        for i, w in enumerate(seq):
            prob = float(probs[i])
            index = 100.0 * prob
            d = details[i]
            if i + 1 < max(7, n // 2):
                index = min(index, 24.0)
                d["insufficient_history"] = True
            if not self.in_season(w.date):
                index = min(index, 24.0)
                d["out_of_season"] = True
            d["probability"] = round(prob, 3)
            out.append(self.point(w.date, clamp(index), d, is_forecast=w.is_forecast))
        return out
