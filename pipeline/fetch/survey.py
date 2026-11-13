"""NCPMS 예찰(SVC51→52→53) 시군구 조사값 수집 — 학습용 일괄 수집과 운영(실시간) 연동이 같이 쓴다.

캐시: data/cache/ncpms/survey/
- 회차 목록: rounds_<예찰구분>_<작물>_<연도>.json — 지난해 이전은 영구, 올해는 하루 지나면 다시 받는다(새 회차)
- 회차별 값: <insectKey>/sido.json, sgg_<시도코드>.json — 값이 있으면 영구
"""
from __future__ import annotations

import re

import json
import time
from dataclasses import dataclass
from datetime import date
from typing import Any, Callable, Optional

from .. import config
from . import ncpms


def normalize_item(name: str) -> str:
    """2026년부터 일부 작물 항목명 앞에 작물명이 붙는다("노지고추 - 탄저병(피해과율)") → 예전 이름("탄저병(피해과율)")으로 맞춘다."""
    return re.sub(r"^[^()]*?\s+-\s+", "", name or "")

CACHE = config.CACHE_DIR / "ncpms" / "survey"
ROUNDS_TTL_SEC = 20 * 3600


@dataclass(frozen=True)
class SurveySpec:
    """model.yaml params.survey — 어떤 예찰 항목을 쓸지."""

    kncr: str              # 작물 코드(예: VC011205 고추)
    examin: str            # 조사 구분 코드(예: 01320 노지고추)
    item: str              # 조사 항목명에 포함될 글자(예: 탄저병)
    predictn: str = "00209"  # 예찰 구분(00204 논벼, 00209 그 외)

    @classmethod
    def from_params(cls, params: dict) -> Optional["SurveySpec"]:
        s = (params or {}).get("survey")
        if not s:
            return None
        return cls(kncr=str(s["kncr"]), examin=str(s["examin"]).zfill(5), item=str(s["item"]), predictn=str(s.get("predictn", "00209")).zfill(5))


class Budget:
    """API 호출 상한(개발계정 일 1,000건)."""

    def __init__(self, limit: int):
        self.limit, self.used = limit, 0

    def take(self) -> None:
        if self.used >= self.limit:
            raise BudgetExceeded(f"NCPMS 호출 상한({self.limit}) 도달")
        self.used += 1


class BudgetExceeded(RuntimeError):
    pass


def _cached(path, budget: Budget, fn: Callable[[], Any], *, ttl: Optional[float] = None, keep_empty: bool = True):
    if path.exists() and (ttl is None or time.time() - path.stat().st_mtime < ttl):
        return json.loads(path.read_text(encoding="utf-8"))
    budget.take()
    data = fn()
    if data or keep_empty:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return data


def collect(key: str, spec: SurveySpec, years: list[int], budget: Budget, *, today: Optional[date] = None) -> list[dict]:
    """연도별 회차를 돌며 시군구 조사값 행을 모은다.

    행: year, round, survey_date(YYYY-MM-DD), sido_code, sido, sigungu_code, sigungu, item, value(문자열)
    """
    today = today or date.today()
    out: list[dict] = []
    for year in years:
        ttl = ROUNDS_TTL_SEC if year >= today.year else None
        rounds = _cached(CACHE / f"rounds_{spec.predictn}_{spec.kncr}_{year}.json", budget,
                         lambda: ncpms.survey_search(key, year, predictn_code=spec.predictn, kncr_code=spec.kncr, display=100), ttl=ttl)
        rounds = [r for r in rounds if r.get("examinSpchcknCode") == spec.examin]
        for rd in sorted(rounds, key=lambda r: int(r.get("examinTmrd") or 0)):
            ik = rd["insectKey"]
            sido_rows = _cached(CACHE / ik / "sido.json", budget, lambda: ncpms.survey_by_sido(key, ik), keep_empty=False)
            for sc, sn in sorted({(r["sidoCode"], r["sidoNm"]) for r in sido_rows if r.get("sidoCode")}):
                sg = _cached(CACHE / ik / f"sgg_{sc}.json", budget, lambda: ncpms.survey_by_sigungu(key, ik, sc), keep_empty=False)
                d = rd.get("inputStdrDatetm", "")
                for r in sg:
                    item = normalize_item(r.get("dbyhsNm", ""))
                    if spec.item not in item:
                        continue
                    out.append({
                        "year": year, "round": rd.get("examinTmrd"),
                        "survey_date": f"{d[:4]}-{d[4:6]}-{d[6:8]}",
                        "sido_code": sc, "sido": sn,
                        "sigungu_code": r.get("sigunguCode", ""), "sigungu": r.get("sigunguNm", ""),
                        "item": item, "value": r.get("inqireValue", ""),
                    })
    return out
