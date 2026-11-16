from models._base.stat import StatModel


class Model(StatModel):
    """예찰 학습형 + 직전 예찰값. 지점 시군(없으면 가장 가까운 예찰 시군)의 최신 예찰값을 history로 받는다."""

    pass
