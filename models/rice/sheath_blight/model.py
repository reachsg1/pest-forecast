"""벼 잎집무늬마름병 모델 — models._base.stat.StatModel 규칙을 그대로 사용.

파라미터는 model.yaml에서 조정한다. 병해충 고유 논리가 필요하면 아래 클래스에서
daily_score()/predict() 등을 재정의한다.
"""
from models._base.stat import StatModel


class Model(StatModel):
    pass
