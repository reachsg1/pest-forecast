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
    "tavg_14d": "최근 14일 평균기온",
    "rh_14d": "최근 14일 평균 상대습도",
    "rain_14d": "최근 14일 누적 강수량(mm)",
    "rain_days_14d": "최근 14일 강수일수(≥1mm)",
    "lwd_14d": "최근 14일 평균 잎젖음(결로)시간",
    "lwd_30d": "최근 30일 평균 잎젖음(결로)시간",
    "rain_days_season": "6월 1일 이후 강수일수(≥1mm)",
    "wet_warm_days_season": "6월 1일 이후 20~30℃이면서 비(≥1mm)가 온 날 수",
    "doy": "연중 일차(계절 진행)",
    "prev_survey_log": "최근 예찰 조사값(같은 해, 그날 이전 최신 회차) log(1+값)",
}


def survey_asof(history: Optional[list], d) -> Optional[dict]:
    """history(예찰 이력: date·value·sigungu·distance_km 사전 목록)에서 d 이전(같은 해) 가장 최근 회차."""
    best = None
    for h in history or []:
        hd = h.get("date")
        if hd is None or hd >= d or hd.year != d.year:
            continue
        if best is None or hd > best["date"]:
            best = h
    return best


def _vals(seq, attr):
    v = [getattr(w, attr) for w in seq]
    return [x for x in v if x is not None]


def compute_features(window: Sequence[DailyWeather]) -> dict[str, float]:
    """window: 오늘을 포함한 최근 N일(오름차순). 30·14·7일 피처는 끝에서 잘라 쓰고,
    시즌 피처(_season)는 window 안에서 그해 6월 1일 이후만 센다(window_days를 충분히 길게)."""
    if not window:
        return {}
    last30, last14, last7 = window[-30:], window[-14:], window[-7:]

    def avg(seq, attr):
        v = _vals(seq, attr)
        return mean(v) if v else float("nan")

    def lwd(seq):
        v = [w.lwd_hours if w.lwd_hours is not None else w.estimated_lwd() for w in seq]
        return mean(v) if v else float("nan")

    f: dict[str, float] = {}
    f["tavg_30d"] = avg(last30, "tavg")
    f["tmin_7d"] = avg(last7, "tmin")
    f["tmax_7d"] = avg(last7, "tmax")
    f["rh_30d"] = avg(last30, "rh")
    rain30 = [w.rain or 0.0 for w in last30]
    f["rain_30d"] = sum(rain30)
    f["rain_days_30d"] = float(sum(1 for r in rain30 if r >= 1.0))
    f["sunshine_7d"] = avg(last7, "sunshine")
    f["tavg_14d"] = avg(last14, "tavg")
    f["rh_14d"] = avg(last14, "rh")
    rain14 = [w.rain or 0.0 for w in last14]
    f["rain_14d"] = sum(rain14)
    f["rain_days_14d"] = float(sum(1 for r in rain14 if r >= 1.0))
    f["lwd_14d"] = lwd(last14)
    f["lwd_30d"] = lwd(last30)
    today = window[-1].date
    season = [w for w in window if w.date.year == today.year and (w.date.month, w.date.day) >= (6, 1)]
    f["rain_days_season"] = float(sum(1 for w in season if (w.rain or 0.0) >= 1.0))
    f["wet_warm_days_season"] = float(sum(1 for w in season if (w.rain or 0.0) >= 1.0 and w.tavg is not None and 20.0 <= w.tavg <= 30.0))
    f["doy"] = float(today.timetuple().tm_yday)
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
        uses_survey = any(f.get("name") == "prev_survey_log" for f in self.params.get("features", []))
        out: list[RiskPoint] = []
        for i, w in enumerate(seq):
            window = seq[max(0, i - n + 1): i + 1]
            feats = compute_features(window)
            ref = None
            if uses_survey:
                # 학습과 같은 규칙: 그날 이전(같은 해) 최신 예찰값, 아직 조사 전이면 0
                ref = survey_asof(history, w.date)
                feats["prev_survey_log"] = math.log1p(max(0.0, float(ref["value"]))) if ref else 0.0
            prob, detail = self.score(feats)
            if uses_survey:
                if history is None:
                    detail["survey_missing"] = True
                elif ref:
                    detail["survey_ref"] = {
                        "date": ref["date"].isoformat(), "value": ref["value"],
                        "sigungu": ref.get("sigungu", ""), "distance_km": ref.get("distance_km", 0.0),
                    }
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
