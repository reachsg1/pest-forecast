"""모델 공통 인터페이스.

모든 모델은 ``BaseModel.predict(weather, history)``를 구현하고
일자별 ``RiskPoint``(위험지수 0~100, 등급, 설명용 입력값) 목록을 돌려준다.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any, Optional, Sequence

import yaml

# 위험도 등급 (설계서 3.2) — NCPMS 발생정보 용어에 맞춤
GRADES: list[tuple[str, int, int]] = [
    ("정상", 0, 24),
    ("예보", 25, 49),
    ("주의보", 50, 74),
    ("경보", 75, 100),
]


def clamp(x: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, x))


def grade_of(index: float) -> str:
    """위험지수(0~100) → 등급명."""
    idx = clamp(index)
    for name, lo, hi in GRADES:
        if idx < hi + 1:  # 24.9 → 정상, 25.0 → 예보
            return name
    return GRADES[-1][0]


def trapezoid(x: Optional[float], lo: float, opt_lo: float, opt_hi: float, hi: float) -> float:
    """사다리꼴 적합도 함수 0~1. x가 None이면 0."""
    if x is None or math.isnan(x):
        return 0.0
    if x <= lo or x >= hi:
        return 0.0
    if opt_lo <= x <= opt_hi:
        return 1.0
    if x < opt_lo:
        return (x - lo) / (opt_lo - lo) if opt_lo > lo else 1.0
    return (hi - x) / (hi - opt_hi) if hi > opt_hi else 1.0


@dataclass
class DailyWeather:
    """지점 1곳의 하루치 기상 입력. 단위: ℃, %, mm, 시간."""

    date: date
    tavg: Optional[float] = None
    tmax: Optional[float] = None
    tmin: Optional[float] = None
    rh: Optional[float] = None          # 일평균 상대습도 %
    rain: Optional[float] = None        # 일강수량 mm
    rain_hours: Optional[float] = None  # 강수 시간(시간별 자료가 있을 때)
    lwd_hours: Optional[float] = None   # 잎젖음지속시간(추정 가능)
    sunshine: Optional[float] = None    # 일조시간
    radiation: Optional[float] = None   # 일사량 MJ/m2
    wind: Optional[float] = None        # 평균풍속 m/s
    soil_moist: Optional[float] = None  # 토양수분 %
    is_forecast: bool = False
    is_interpolated: bool = False

    def estimated_lwd(self) -> float:
        """잎젖음시간이 관측되지 않았을 때의 추정값(시간).

        - 강우일: 강수시간(없으면 6시간)에 습도 기여분을 더함
        - 무강우일: 습도 70%→0h, 100%→12h 선형
        초기 추정식이며 시간별 습도 자료가 붙으면 실측(RH≥90% 시간 합)으로 교체한다.
        """
        if self.lwd_hours is not None:
            return self.lwd_hours
        rh = self.rh if self.rh is not None else 70.0
        rh_part = clamp((rh - 70.0) / 30.0 * 12.0, 0.0, 12.0)
        if self.rain is not None and self.rain > 0:
            base = self.rain_hours if self.rain_hours is not None else 6.0
            return clamp(max(base, 6.0) + rh_part * 0.5, 0.0, 24.0)
        return rh_part


@dataclass
class RiskPoint:
    date: date
    index: float
    grade: str
    inputs: dict[str, Any] = field(default_factory=dict)
    is_forecast: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "date": self.date.isoformat(),
            "index": round(self.index, 1),
            "grade": self.grade,
            "is_forecast": self.is_forecast,
            "inputs": {k: (round(v, 2) if isinstance(v, float) else v) for k, v in self.inputs.items()},
        }


@dataclass
class ModelCard:
    """``model.yaml``의 내용. 화면의 '예측 근거' 탭에 그대로 렌더링된다."""

    id: str
    pest_id: str
    name_ko: str
    crop: str
    kind: str                 # disease | insect
    type: str                 # A(감염조건) | B(적산온도) | C(통계·ML)
    version: str
    horizon_days: int
    season: dict[str, int]    # {"start_month": 6, "end_month": 9}
    inputs: list[str]
    params: dict[str, Any]
    name_sci: str = ""
    ncpms_key: str = ""
    ncpms_kind: str = ""      # sick | insect
    description: str = ""
    logic: str = ""
    references: list[str] = field(default_factory=list)
    owner: str = ""
    status: str = "draft"     # draft | reviewed | active
    path: str = ""

    @classmethod
    def from_yaml(cls, path: Path) -> "ModelCard":
        raw = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
        known = {k for k in cls.__dataclass_fields__}
        data = {k: v for k, v in raw.items() if k in known}
        data.setdefault("inputs", [])
        data.setdefault("params", {})
        data.setdefault("references", [])
        data["path"] = str(Path(path).parent)
        return cls(**data)

    def to_dict(self) -> dict[str, Any]:
        d = {k: getattr(self, k) for k in self.__dataclass_fields__}
        d.pop("path", None)
        return d


class BaseModel:
    """모든 병해충 모델의 부모 클래스."""

    def __init__(self, card: ModelCard):
        self.card = card
        self.params = dict(card.params or {})

    # --- 하위 클래스가 구현 -------------------------------------------------
    def predict(self, weather: Sequence[DailyWeather], history: Optional[list] = None) -> list[RiskPoint]:
        raise NotImplementedError

    # --- 공통 유틸 ---------------------------------------------------------
    def in_season(self, d: date) -> bool:
        s = int(self.card.season.get("start_month", 1))
        e = int(self.card.season.get("end_month", 12))
        if s <= e:
            return s <= d.month <= e
        return d.month >= s or d.month <= e  # 연도를 넘기는 시즌

    def point(self, d: date, index: float, inputs: dict[str, Any], is_forecast: bool = False) -> RiskPoint:
        idx = clamp(index)
        return RiskPoint(date=d, index=idx, grade=grade_of(idx), inputs=inputs, is_forecast=is_forecast)
