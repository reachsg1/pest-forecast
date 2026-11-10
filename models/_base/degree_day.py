"""유형 B — 발육 단계 모델(유효적산온도).

생물기준일(biofix, 기본 1월 1일)부터 일평균기온으로 유효적산온도(DD)를 누적하고,
피해 단계(예: 부화 유충기) 구간에 들어오면 위험지수를 올린다.

model.yaml의 params 예::

    base_temp: 10.0          # 발육영점온도(℃)
    upper_temp: 35.0         # 상한온도(이 이상은 상한값으로 계산)
    biofix: "01-01"          # MM-DD
    ramp_dd: 60              # 구간 가장자리에서 지수가 오르내리는 폭(DD)
    activity_temp: {min: 12, opt_low: 20, opt_high: 30, max: 36}  # 활동 적합 온도
    generations:             # 피해 단계 DD 구간
      - {name: "1세대 부화·유충", dd_from: 250, dd_to: 450, peak: 90}
      - {name: "2세대 부화·유충", dd_from: 850, dd_to: 1050, peak: 100}
"""
from __future__ import annotations

from datetime import date
from typing import Optional, Sequence

from .interface import BaseModel, DailyWeather, RiskPoint, clamp, trapezoid


class DegreeDayModel(BaseModel):
    type_code = "B"

    def _biofix(self, year: int) -> date:
        mmdd = str(self.params.get("biofix", "01-01"))
        m, d = (int(x) for x in mmdd.split("-"))
        return date(year, m, d)

    def daily_dd(self, w: DailyWeather) -> float:
        base = float(self.params.get("base_temp", 10.0))
        upper = float(self.params.get("upper_temp", 35.0))
        if w.tavg is None:
            if w.tmax is not None and w.tmin is not None:
                t = (w.tmax + w.tmin) / 2.0
            else:
                return 0.0
        else:
            t = w.tavg
        return max(0.0, min(t, upper) - base)

    def window_activity(self, dd: float) -> tuple[float, str]:
        """누적 DD가 피해 구간 안에 있는 정도(0~1)와 구간 이름."""
        ramp = float(self.params.get("ramp_dd", 60.0))
        best, name = 0.0, ""
        for g in self.params.get("generations", []):
            lo, hi = float(g["dd_from"]), float(g["dd_to"])
            peak = float(g.get("peak", 100.0)) / 100.0
            if lo <= dd <= hi:
                a = 1.0
            elif lo - ramp < dd < lo:
                a = (dd - (lo - ramp)) / ramp
            elif hi < dd < hi + ramp:
                a = (hi + ramp - dd) / ramp
            else:
                a = 0.0
            a *= peak
            if a > best:
                best, name = a, str(g.get("name", ""))
        return best, name

    def predict(self, weather: Sequence[DailyWeather], history: Optional[list] = None) -> list[RiskPoint]:
        at = self.params.get("activity_temp", {})
        out: list[RiskPoint] = []
        acc = 0.0
        cur_year: Optional[int] = None
        for w in sorted(weather, key=lambda x: x.date):
            if cur_year != w.date.year:
                cur_year = w.date.year
                acc = 0.0
            if w.date >= self._biofix(w.date.year):
                acc += self.daily_dd(w)
            activity, stage = self.window_activity(acc)
            temp_suit = trapezoid(
                w.tavg,
                float(at.get("min", 10)),
                float(at.get("opt_low", 18)),
                float(at.get("opt_high", 30)),
                float(at.get("max", 36)),
            ) if at else 1.0
            index = 100.0 * activity * (0.5 + 0.5 * temp_suit)
            if not self.in_season(w.date):
                index = min(index, 24.0)
            inputs = {
                "tavg": w.tavg,
                "degree_days": round(acc, 1),
                "stage": stage,
                "stage_activity": round(activity, 2),
                "temp_suitability": round(temp_suit, 2),
            }
            out.append(self.point(w.date, clamp(index), inputs, is_forecast=w.is_forecast))
        return out
