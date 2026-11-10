"""예찰 실시간 연동 — 예찰값을 입력으로 쓰는 모델(params.survey + 피처 prev_survey_log)에 지점별 예찰 이력을 만든다.

- 운영(live): 올해 NCPMS 예찰(SVC51→52→53)을 받아(회차 목록은 하루 캐시, 회차 값은 영구 캐시) 시군별 이력을 만든다.
- 데모(demo): 기준일 전년도의 실제 예찰값(캐시)을 날짜만 기준 연도로 옮겨 쓴다. 화면·status에 그렇게 표시한다.
- 지점 → 예찰 시군: 지점 시군이 예찰 대상이면 그 시군, 아니면 예찰이 있는 시군 중 지점에서 가장 가까운 곳
  (pipeline/regions.py). 나중에 그 시군 예찰이 생기면 다음 실행부터 자동으로 자기 시군 값을 쓴다.
"""
from __future__ import annotations

import logging
from collections import defaultdict
from datetime import date
from typing import Iterable

from models._base.registry import LoadedModel

from . import config, regions
from .fetch.survey import Budget, BudgetExceeded, SurveySpec, collect

log = logging.getLogger(__name__)

LIVE_CALL_BUDGET = 150  # 실행 1회 상한(새 회차 1~2개면 약 20건)


def uses_survey(lm: LoadedModel) -> bool:
    p = lm.card.params or {}
    return bool(p.get("survey")) and any(f.get("name") == "prev_survey_log" for f in p.get("features", []))


def _to_float(v) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def by_sigungu(rows: Iterable[dict], *, shift_to_year: int | None = None) -> dict[str, list[dict]]:
    """수집 행 → '시도 시군' → [{date, value}] (수치 아닌 값은 버림)."""
    out: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        v = _to_float(r.get("value"))
        if v is None or not r.get("sigungu"):
            continue
        y, m, d = (int(x) for x in r["survey_date"].split("-"))
        if shift_to_year:
            y = shift_to_year
        out[regions.key_of(r["sido"], r["sigungu"])].append({"date": date(y, m, d), "value": v})
    for k in out:
        out[k].sort(key=lambda h: h["date"])
    return dict(out)


def spot_history(spots: list[dict], surveyed: dict[str, list[dict]]) -> tuple[dict[str, list[dict]], dict[str, dict]]:
    """지점별 예찰 이력과 출처(시군·거리)."""
    hist: dict[str, list[dict]] = {}
    src_info: dict[str, dict] = {}
    if not surveyed:
        return hist, src_info
    for sp in spots:
        key = regions.key_from_address(sp.get("sigungu", ""))
        loc = (sp["lat"], sp["lon"]) if sp.get("lat") is not None and sp.get("lon") is not None else None
        src = regions.resolve(key, surveyed.keys(), target_loc=loc) if (key or loc) else None
        if src is None:
            continue
        hist[sp["spot_code"]] = [{**h, "sigungu": src.key, "distance_km": src.distance_km} for h in surveyed[src.key]]
        src_info[sp["spot_code"]] = {"sigungu": src.key, "distance_km": src.distance_km}
    return hist, src_info


def build(models: list[LoadedModel], spots: list[dict], issued: date, mode: str, warnings: list[str]) -> tuple[dict, dict]:
    """반환: (history[model_id][spot_code], info[model_id]) — info는 status.json·화면 표시용."""
    history: dict[str, dict[str, list]] = {}
    info: dict[str, dict] = {}
    key = config.ncpms_key()
    budget = Budget(LIVE_CALL_BUDGET if mode == "live" else 0)
    for lm in models:
        if not uses_survey(lm):
            continue
        spec = SurveySpec.from_params(lm.card.params)
        year = issued.year if mode == "live" else issued.year - 1
        rows: list[dict] = []
        try:
            if mode == "live" and not key:
                raise BudgetExceeded("NCPMS_API_KEY 없음")
            rows = collect(key, spec, [year], budget, today=issued)
        except BudgetExceeded as e:
            warnings.append(f"{lm.id}: 예찰 자료를 받지 못함({e}) — 예찰값 없이(0으로) 계산")
        except Exception as e:  # noqa: BLE001
            log.exception("예찰 수집 실패 %s", lm.id)
            warnings.append(f"{lm.id}: 예찰 수집 오류({type(e).__name__}) — 예찰값 없이(0으로) 계산")
        surveyed = by_sigungu(rows, shift_to_year=issued.year if mode != "live" else None)
        # 기준일 이후 회차는 쓰지 않는다(재현 실행 대비)
        surveyed = {k: [h for h in v if h["date"] <= issued] for k, v in surveyed.items()}
        surveyed = {k: v for k, v in surveyed.items() if v}
        hist, src = spot_history(spots, surveyed)
        history[lm.id] = hist
        last = max((h["date"] for v in surveyed.values() for h in v), default=None)
        info[lm.id] = {
            "source": "NCPMS 병해충 예찰(SVC51~53)" if mode == "live" else f"데모: {year}년 실제 예찰값을 날짜만 {issued.year}년으로 옮겨 사용",
            "item": spec.item,
            "year": year,
            "n_sigungu": len(surveyed),
            "latest_survey": last.isoformat() if last else None,
            "spots_substituted": sum(1 for v in src.values() if v["distance_km"] > 0),
            "spots": src,
            "api_calls": budget.used,
        }
        if not surveyed:
            warnings.append(f"{lm.id}: {issued.isoformat()} 이전 예찰 회차가 없어 예찰값 0으로 계산(시즌 전이면 정상)")
    return history, info
