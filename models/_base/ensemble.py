"""유형 E — 여러 모델 결과의 평균(앙상블).

model.yaml params:
    members: [model_id …]   같은 병해충의 다른 모델 id

계산은 구성 모델이 모두 돈 뒤 pipeline/run_models.py 가 한다(같은 지점·같은 날 위험지수 평균).
predict()는 단독으로 쓰지 않는다. 구성 모델 중 하나라도 빠지면(--models 로 일부만 실행 등) 건너뛴다.
"""
from __future__ import annotations

from typing import Optional, Sequence

from .interface import BaseModel, DailyWeather, RiskPoint


class EnsembleModel(BaseModel):
    type_code = "E"

    @property
    def members(self) -> list[str]:
        return list(self.params.get("members", []))

    def predict(self, weather: Sequence[DailyWeather], history: Optional[list] = None) -> list[RiskPoint]:
        return []  # run_models.combine_ensembles 가 구성 모델 결과로 만든다
