"""유형 C — 통계·기계학습 모델 자리.

1단계에서는 최근 N일 기상 통계에 가중치를 주는 로지스틱 휴리스틱으로 시작하고,
예찰조사(2015~2025)가 적재되면 ``pipeline/train_template.py``로 학습한 계수(또는
LightGBM 모델 파일)로 교체한다. 피처 이름은 그대로 두고 가중치만 바꾸면 된다.

model.yaml의 params 예::

    window_days: 30
    bias: -0.8
    features:
      - {name: tavg_30d, center: 26, scale: 3, weight: 1.2}
      - {name: rh_30d,   center: 85, scale: 5, weight: 1.0}
      - {name: rain_days_30d, center: 12, scale: 4, weight: 0.6}
      - {name: tmin_7d,  center: 22, scale: 3, weight: 0.8}
"""
from __future__ import annotations

import math
from statistics import mean
from typing import Optional, Sequence

from .interface import BaseModel, DailyWeather, RiskPoint, clamp

FEATURE_HELP = {
    "tavg_30d": "최근 30일 평균기온",
    "tmin_7d": "최근 7일 평균 최저기온",
    "tmax_7d": "최근 7일 평균 최고기온",
    "rh_30d": "최근 30일 평균 상대습도",
    "rain_30d": "최근 30일 누적 강수량(mm)",
    "rain_days_30d": "최근 30일 강수일수(≥1mm)",
    "sunshine_7d": "최근 7일 평균 일조시간",
}


def _vals(seq, attr):
    v = [getattr(w, attr) for w in seq]
    return [x for x in v if x is not None]


def compute_features(window: Sequence[DailyWeather]) -> dict[str, float]:
    """window: 오늘을 포함한 최근 N일(오름차순)."""
    last7 = window[-7:]
    f: dict[str, float] = {}
    t = _vals(window, "tavg")
    f["tavg_30d"] = mean(t) if t else float("nan")
    tn = _vals(last7, "tmin")
    f["tmin_7d"] = mean(tn) if tn else float("nan")
    tx = _vals(last7, "tmax")
    f["tmax_7d"] = mean(tx) if tx else float("nan")
    rh = _vals(window, "rh")
    f["rh_30d"] = mean(rh) if rh else float("nan")
    rain = [w.rain or 0.0 for w in window]
    f["rain_30d"] = sum(rain)
    f["rain_days_30d"] = float(sum(1 for r in rain if r >= 1.0))
    sun = _vals(last7, "sunshine")
    f["sunshine_7d"] = mean(sun) if sun else float("nan")
    return f


class StatModel(BaseModel):
    type_code = "C"

    def score(self, feats: dict[str, float]) -> tuple[float, dict]:
        z_total = float(self.params.get("bias", 0.0))
        detail = {}
        for spec in self.params.get("features", []):
            name = spec["name"]
            x = feats.get(name, float("nan"))
            if x is None or (isinstance(x, float) and math.isnan(x)):
                continue
            z = (x - float(spec.get("center", 0.0))) / max(1e-6, float(spec.get("scale", 1.0)))
            z = max(-3.0, min(3.0, z))
            z_total += float(spec.get("weight", 1.0)) * z
            detail[name] = round(x, 1)
        prob = 1.0 / (1.0 + math.exp(-z_total))
        return prob, detail

    def predict(self, weather: Sequence[DailyWeather], history: Optional[list] = None) -> list[RiskPoint]:
        n = int(self.params.get("window_days", 30))
        seq = sorted(weather, key=lambda x: x.date)
        out: list[RiskPoint] = []
        for i, w in enumerate(seq):
            window = seq[max(0, i - n + 1): i + 1]
            feats = compute_features(window)
            prob, detail = self.score(feats)
            index = 100.0 * prob
            if len(window) < max(7, n // 2):
                index = min(index, 24.0)   # 자료가 짧으면 판단 보류
                detail["insufficient_history"] = True
            if not self.in_season(w.date):
                index = min(index, 24.0)
                detail["out_of_season"] = True
            detail["probability"] = round(prob, 3)
            out.append(self.point(w.date, clamp(index), detail, is_forecast=w.is_forecast))
        return out
