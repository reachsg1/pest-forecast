"""지점 × 모델 실행 → 결과 행 목록."""
from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Iterable

from models._base import DailyWeather
from models._base.interface import clamp, grade_of
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
    survey_history: dict[str, dict[str, list]] | None = None,
) -> list[dict]:
    """반환 행: spot_code, pest_id, model_id, model_version, issued_date, target_date,
    offset_days(음수=과거), index, grade, is_forecast, inputs, na_reason, raw_index

    생물계절 판정(phenology)에서 작물이 포장에 없다고 나온 날은 index/grade를 None으로 두고
    na_reason(not_grown | off_season)을 채운다. raw_index는 검증·디버깅용 원래 모델 값이다.
    assessments가 주어지면 (spot_code, crop)별 판정 결과를 거기에 기록한다.
    survey_history[model_id][spot_code]는 예찰 이력(pipeline/survey_live.py)으로, 예찰값을 쓰는 모델에 넘긴다.
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
            if lm.card.type == "E":
                continue  # 앙상블은 구성 모델 결과로 아래에서 만든다
            try:
                hist = (survey_history or {}).get(lm.id)
                pts = lm.model.predict(wx, hist.get(code, []) if hist is not None else None)
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
    rows.extend(combine_ensembles(rows, models))
    return rows


def combine_ensembles(rows: list[dict], models: list[LoadedModel]) -> list[dict]:
    """유형 E(앙상블): 구성 모델의 같은 지점·같은 날 위험지수(raw_index) 평균. 재배 여부·시기 판정은 구성 모델과 같다.
    구성 모델 중 하나라도 이번 실행에 없으면 그 앙상블은 건너뛴다."""
    ran = {r["model_id"] for r in rows}
    out: list[dict] = []
    for lm in models:
        if lm.card.type != "E":
            continue
        members = list(lm.card.params.get("members", []))
        if not members or any(m not in ran for m in members):
            log.warning("앙상블 %s: 구성 모델(%s) 중 실행되지 않은 것이 있어 건너뜀", lm.id, members)
            continue
        by_key: dict[tuple[str, str], dict[str, dict]] = {}
        for r in rows:
            if r["model_id"] in members:
                by_key.setdefault((r["spot_code"], r["target_date"]), {})[r["model_id"]] = r
        for (code, d), mr in by_key.items():
            if len(mr) < len(members):
                continue
            first = mr[members[0]]
            raw = sum(mr[m]["raw_index"] for m in members) / len(members)
            applicable = first["na_reason"] is None
            idx = clamp(raw)
            out.append({
                **{k: first[k] for k in ("spot_code", "pest_id", "issued_date", "target_date", "offset_days", "is_forecast", "na_reason")},
                "model_id": lm.id,
                "model_version": lm.card.version,
                "index": round(idx, 1) if applicable else None,
                "grade": grade_of(idx) if applicable else None,
                "raw_index": round(idx, 1),
                "inputs": {
                    "members": {m: mr[m]["raw_index"] for m in members},
                    "agree_alert": sum(1 for m in members if mr[m]["raw_index"] >= 50),  # 주의보 이상으로 본 모델 수
                    **({"survey_ref": first["inputs"]["survey_ref"]} if isinstance(first.get("inputs"), dict) and first["inputs"].get("survey_ref") else {}),
                },
            })
    return out
