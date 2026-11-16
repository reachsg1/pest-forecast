"""예찰 조사 항목 고르기·합치기 — 학습(survey_train)·추이(survey_trend)·실시간(survey_live)이 같은 규칙을 쓴다.

항목 지정(spec) 형식
- 정확한 이름: "탄저병(피해과율)"
- 여러 항목 합치기: "벼멸구(발생면적율)|흰등멸구(발생면적율)" — 같은 시군·같은 조사일이면 최댓값(하나라도 발생 = 발생)
- 괄호 없는 예전 형식("탄저병"): 이름에 그 글자가 들어가면 같은 항목(초기 고추 모델 호환)
비율 항목(이름에 '율' 포함)은 0~100으로 자른다(NCPMS 원자료에 100 넘는 면적율이 드물게 있음).
"""
from __future__ import annotations

from typing import Iterable


def parts(spec: str) -> list[str]:
    return [p.strip() for p in (spec or "").split("|") if p.strip()]


def match(item: str, spec: str) -> bool:
    if not parts(spec):
        return True  # 빈 지정 = 모든 항목(백필이 회차 전체를 캐시할 때)
    for p in parts(spec):
        if "(" in p:
            if item == p:
                return True
        elif p in item:
            return True
    return False


def is_rate(spec: str) -> bool:
    return any("율" in p for p in parts(spec))


def _num(v) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def combine(rows: Iterable[dict], spec: str) -> list[dict]:
    """예찰 행(year, survey_date, sido, sigungu, item, value …) → spec에 맞는 행만, 시군·조사일마다 한 행(최댓값).
    값은 float, item은 spec 그대로. 수치가 아니거나 시군이 없는 행은 버린다."""
    clip = is_rate(spec)
    best: dict[tuple, dict] = {}
    for r in rows:
        if not r.get("sigungu") or not match(r.get("item", ""), spec):
            continue
        v = _num(r.get("value"))
        if v is None:
            continue
        if clip:
            v = min(max(v, 0.0), 100.0)
        k = (r.get("sido", ""), r["sigungu"], r["survey_date"])
        if k not in best or v > best[k]["value"]:
            best[k] = {**r, "item": spec, "value": v}
    return list(best.values())
