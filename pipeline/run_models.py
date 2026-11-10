"""지점 × 모델 실행 → 결과 행 목록."""
from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Iterable

from models._base import DailyWeather
from models._base.registry import LoadedModel

from . import config
from .phenology import OK, Phenology, SpotCrop

log = logging.getLogger(__name__)


def run_all(
    spots: list[dict],
    weather_by_spot: dict[str, list[DailyWeather]],
    models: Iterable[LoadedModel],
    issued: date,
    horizon: int = config.HORIZON_DAYS_DEFAULT,
    history_days: int = config.HISTORY_DAYS_SHOWN,
    phenology: Phenology | None = None,
    assessments: dict[tuple[str, str], SpotCrop] | None = None,
) -> list[dict]:
    """반환 행: spot_code, pest_id, model_id, model_version, issued_date, target_date,
    offset_days(음수=과거), index, grade, is_forecast, inputs, na_reason, raw_index

    생물계절 판정(phenology)에서 작물이 포장에 없다고 나온 날은 index/grade를 None으로 두고
    na_reason(not_grown | off_season)을 채운다. raw_index는 검증·디버깅용 원래 모델 값이다.
    assessments가 주어지면 (spot_code, crop)별 판정 결과를 거기에 기록한다.
    """
    models = list(models)
    rows: list[dict] = []
    lo, hi = issued - timedelta(days=history_days), issued + timedelta(days=horizon)
    for sp in spots:
        code = sp["spot_code"]
        wx = weather_by_spot.get(code) or []
        if not wx:
            continue
        for lm in models:
            crop = lm.card.crop
            sc = phenology.assess(crop, sp.get("sigungu", "")) if phenology else None
            if sc is not None and assessments is not None:
                assessments[(code, crop)] = sc
            try:
                pts = lm.model.predict(wx)
            except Exception as e:  # noqa: BLE001
                log.exception("모델 %s 지점 %s 실패: %s", lm.id, code, e)
                continue
            for p in pts:
                if p.date < lo or p.date > hi:
                    continue
                status = sc.status_on(p.date) if sc else OK
                applicable = status == OK
                rows.append(
                    {
                        "spot_code": code,
                        "pest_id": lm.card.pest_id,
                        "model_id": lm.id,
                        "model_version": lm.card.version,
                        "issued_date": issued.isoformat(),
                        "target_date": p.date.isoformat(),
                        "offset_days": (p.date - issued).days,
                        "index": round(p.index, 1) if applicable else None,
                        "grade": p.grade if applicable else None,
                        "is_forecast": p.is_forecast,
                        "inputs": p.inputs,
                        "na_reason": None if applicable else status,
                        "raw_index": round(p.index, 1),
                    }
                )
    return rows
