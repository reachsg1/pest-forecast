"""유형 A — 감염 조건 모델(규칙 기반).

하루치 감염 가능성 s_t = 온도 적합도 × 잎젖음(습윤) 충족도 (0~1)
감염 부하 load_t = decay × load_{t-1} + s_t
위험지수      = 100 × load_t / load_sat   (load_sat = '연속으로 완전히 유리한 날' 수, 경보 기준)

model.yaml의 params 예::

    temp: {min: 15, opt_low: 22, opt_high: 28, max: 32}
    wetness_hours:                  # 온도별 감염에 필요한 잎젖음시간(시간)
      - {temp: 15, hours: 12}
      - {temp: 20, hours: 8}
      - {temp: 25, hours: 5}
      - {temp: 30, hours: 6}
    rain_trigger_mm: 2.0            # 이 이상의 비는 포자 비산·젖음 조건으로 간주
    decay: 0.7                      # 전날 부하의 잔존 비율
    load_sat: 2.5                   # 이 부하에서 위험지수 100
    soil_moist_boost: {threshold: 30, factor: 1.3}   # 선택. 토양수분이 임계 이상이면 가중
"""
from __future__ import annotations

from typing import Optional, Sequence

from .interface import BaseModel, DailyWeather, RiskPoint, trapezoid


def _interp(table: list[dict], temp: float) -> float:
    """온도별 요구 젖음시간 표를 선형 보간."""
    pts = sorted((float(r["temp"]), float(r["hours"])) for r in table)
    if not pts:
        return 8.0
    if temp <= pts[0][0]:
        return pts[0][1]
    if temp >= pts[-1][0]:
        return pts[-1][1]
    for (t0, h0), (t1, h1) in zip(pts, pts[1:]):
        if t0 <= temp <= t1:
            w = (temp - t0) / (t1 - t0) if t1 > t0 else 0.0
            return h0 + (h1 - h0) * w
    return pts[-1][1]


class InfectionModel(BaseModel):
    type_code = "A"

    def daily_score(self, w: DailyWeather) -> tuple[float, dict]:
        p = self.params
        t = p.get("temp", {})
        temp_suit = trapezoid(
            w.tavg,
            float(t.get("min", 10)),
            float(t.get("opt_low", 20)),
            float(t.get("opt_high", 28)),
            float(t.get("max", 33)),
        )
        lwd = w.estimated_lwd()
        rain = w.rain or 0.0
        if rain >= float(p.get("rain_trigger_mm", 2.0)):
            lwd = max(lwd, float(p.get("rain_min_wet_hours", 8.0)))
        need = _interp(p.get("wetness_hours", []), w.tavg if w.tavg is not None else 20.0)
        wet_suit = min(1.0, lwd / need) if need > 0 else 0.0
        score = temp_suit * wet_suit
        boost = p.get("soil_moist_boost")
        if boost and w.soil_moist is not None and w.soil_moist >= float(boost.get("threshold", 30)):
            score = min(1.0, score * float(boost.get("factor", 1.3)))
        inputs = {
            "tavg": w.tavg,
            "rain_mm": rain,
            "lwd_hours": round(lwd, 1),
            "wet_hours_required": round(need, 1),
            "temp_suitability": round(temp_suit, 2),
            "wetness_suitability": round(wet_suit, 2),
        }
        return score, inputs

    def predict(self, weather: Sequence[DailyWeather], history: Optional[list] = None) -> list[RiskPoint]:
        decay = float(self.params.get("decay", 0.7))
        load_sat = float(self.params.get("load_sat", 2.5))
        load = 0.0
        out: list[RiskPoint] = []
        for w in sorted(weather, key=lambda x: x.date):
            score, inputs = self.daily_score(w)
            load = decay * load + score
            index = 100.0 * load / load_sat if load_sat > 0 else 0.0
            if not self.in_season(w.date):
                index = min(index, 24.0)  # 시즌 밖에서는 '정상' 상한
                inputs["out_of_season"] = True
            inputs["daily_score"] = round(score, 2)
            inputs["infection_load"] = round(load, 2)
            out.append(self.point(w.date, index, inputs, is_forecast=w.is_forecast))
        return out
