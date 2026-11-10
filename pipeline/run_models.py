"""지점 × 모델 실행 → 결과 행 목록."""
from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Iterable

from models._base import DailyWeather
from models._base.registry import LoadedModel

from . import config

log = logging.getLogger(__name__)


def run_all(
    spots: list[dict],
    weather_by_spot: dict[str, list[DailyWeather]],
    models: Iterable[LoadedModel],
    issued: date,
    horizon: int = config.HORIZON_DAYS_DEFAULT,
    history_days: int = config.HISTORY_DAYS_SHOWN,
) -> list[dict]:
    """반환 행: spot_code, pest_id, model_id, model_version, issued_date, target_date,
    offset_days(음수=과거), index, grade, is_forecast, inputs"""
    models = list(models)
    rows: list[dict] = []
    lo, hi = issued - timedelta(days=history_days), issued + timedelta(days=horizon)
    for sp in spots:
        code = sp["spot_code"]
        wx = weather_by_spot.get(code) or []
        if not wx:
            continue
        for lm in models:
            try:
                pts = lm.model.predict(wx)
            except Exception as e:  # noqa: BLE001
                log.exception("모델 %s 지점 %s 실패: %s", lm.id, code, e)
                continue
            for p in pts:
                if p.date < lo or p.date > hi:
                    continue
                rows.append(
                    {
                        "spot_code": code,
                        "pest_id": lm.card.pest_id,
                        "model_id": lm.id,
                        "model_version": lm.card.version,
                        "issued_date": issued.isoformat(),
                        "target_date": p.date.isoformat(),
                        "offset_days": (p.date - issued).days,
                        "index": round(p.index, 1),
                        "grade": p.grade,
                        "is_forecast": p.is_forecast,
                        "inputs": p.inputs,
                    }
                )
    return rows
