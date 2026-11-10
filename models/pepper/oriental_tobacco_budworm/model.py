"""담배나방(Helicoverpa assulta) 모델 — models._base.degree_day.DegreeDayModel 규칙을 그대로 사용.

파라미터와 근거는 model.yaml 참고. 세대별 성충 발생최성기 CEDD에 가까울수록 위험지수가 오른다.
"""
from models._base.degree_day import DegreeDayModel


class Model(DegreeDayModel):
    pass
