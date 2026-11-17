"""서비스 노출 기준 — 예찰로 검증한 정확도가 기준을 넘는 병해충만 일반 화면에 보인다.

기준 1 — 자료 완비: 2015년부터 마지막으로 끝난 시즌(11월부터는 올해)까지 예찰 자료가 한 해도 빠짐없이 있어야 한다
  (data/survey/ncpms_<pest>_sigungu.csv, 정답 항목 pipeline/survey_trend.ITEMS). 빠진 해가 있으면 제외.
기준 2 — 정확도(기본 모델의 eval.json, 학습에 쓰지 않은 시험 연도):
- 예찰 검증(status = survey_evaluated)이 있어야 한다. 규칙형만 있고 예찰로 맞춰 보지 못했으면 '검증 전'.
- AUC ≥ MIN_AUC (어디가 더 위험한지 가리는 힘)
- 재현율(실제 발생 중 위험지수 50 이상으로 미리 알린 비율) ≥ MIN_RECALL — 대부분 '정상'으로 보이는 모델 방지
기준에 못 미치는 병해충도 배치는 계속 계산하고(관리자 '모델 검증'에서 보임), 예찰이 쌓여 모델이 다시 만들어지거나
정확도가 오르면 다음 배치부터 자동으로 서비스 목록에 나온다(scripts/auto_models.py 주간 실행).
"""
from __future__ import annotations

import csv
from datetime import date
from functools import lru_cache

from . import config

MIN_AUC = 0.75
MIN_RECALL = 0.40
FIRST_YEAR = 2015


def last_season(today: date) -> int:
    return today.year if today.month >= 11 else today.year - 1


@lru_cache(maxsize=None)
def survey_years(pest_id: str) -> frozenset[int]:
    from .survey_items import combine
    from .survey_trend import ITEMS

    p = config.DATA_DIR / "survey" / f"ncpms_{pest_id}_sigungu.csv"
    if pest_id not in ITEMS or not p.exists():
        return frozenset()
    with p.open(encoding="utf-8") as f:
        return frozenset(int(r["year"]) for r in combine(csv.DictReader(f), ITEMS[pest_id][0]))


def missing_years(pest_id: str, today: date) -> list[int]:
    have = survey_years(pest_id)
    return [y for y in range(FIRST_YEAR, last_season(today) + 1) if y not in have]


def decide(ev: dict | None, pest_id: str = "", today: date | None = None) -> dict:
    ev = ev or {}
    if pest_id:
        miss = missing_years(pest_id, today or date.today())
        if miss:
            span = f"{miss[0]}" if len(miss) == 1 else f"{miss[0]}~{miss[-1]}" if miss == list(range(miss[0], miss[-1] + 1)) else ", ".join(map(str, miss))
            return {"listed": False, "reason": f"예찰 자료 미완비({span}년 없음)", "auc": None, "recall": None, "missing_years": miss}
    if ev.get("status") != "survey_evaluated" or not isinstance(ev.get("test"), dict):
        return {"listed": False, "reason": "예찰 검증 전(검증할 예찰 자료가 아직 부족)", "auc": None, "recall": None}
    t = ev["test"]
    auc = (t.get("auc") or {}).get("survey_logit")
    recall = ((t.get("classification") or {}).get("survey_logit") or {}).get("recall")
    out = {"auc": auc, "recall": recall, "min_auc": MIN_AUC, "min_recall": MIN_RECALL}
    if auc is None or auc < MIN_AUC:
        return {**out, "listed": False, "reason": f"정확도(AUC {auc}) 기준 {MIN_AUC} 미만"}
    if recall is None or recall < MIN_RECALL:
        return {**out, "listed": False, "reason": f"실제 발생을 미리 알린 비율 {recall} — 기준 {MIN_RECALL} 미만"}
    return {**out, "listed": True, "reason": "예찰 검증 통과"}
