"""NCPMS(국가농작물병해충관리시스템) 오픈API.

호출 형식: http://ncpms.rda.go.kr/npmsAPI/service?apiKey=...&serviceCode=SVCxx&... (XML)
확인된 서비스 코드는 config.NCPMS_SERVICE_CODES 참고. 응답 태그는 서비스마다 다르므로
사전(dict) 그대로 돌려주고, 화면용 변환은 publish 단계에서 한다.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Optional

from .. import config
from .http import get, xml_items

log = logging.getLogger(__name__)


def call(key: str, service_code: str, **params: Any) -> list[dict[str, str]]:
    if not service_code:
        raise ValueError("서비스 코드가 비어 있습니다. config.NCPMS_SERVICE_CODES를 채우세요.")
    q = {"apiKey": key, "serviceCode": service_code, **params}
    r = get(config.NCPMS_BASE, q)
    return xml_items(r.text, item_tag="item")


XML = config.NCPMS_SERVICE_TYPE_XML  # 검색·예찰 계열 필수 파라미터 serviceType


def disease_search(key: str, crop_name: str = "", disease_name: str = "", display: int = 50) -> list[dict]:
    """SVC01 병 검색 → cropName, sickNameKor, sickKey, thumbImg …"""
    p: dict[str, Any] = {"serviceType": XML, "displayCount": display}
    if crop_name:
        p["cropName"] = crop_name
    if disease_name:
        p["sickNameKor"] = disease_name
    return call(key, config.NCPMS_SERVICE_CODES["disease_search"], **p)


def disease_detail(key: str, sick_key: str) -> list[dict]:
    """SVC05 병 상세 → infectionRoute, developmentCondition, symptoms, preventionMethod, imageList …"""
    return call(key, config.NCPMS_SERVICE_CODES["disease_detail"], sickKey=sick_key)


def insect_search(key: str, crop_name: str = "", insect_name: str = "", display: int = 50) -> list[dict]:
    """SVC03 해충 검색 → cropName, insectKorName, speciesName, insectKey …"""
    p: dict[str, Any] = {"serviceType": XML, "displayCount": display}
    if crop_name:
        p["cropName"] = crop_name
    if insect_name:
        p["insectKorName"] = insect_name
    return call(key, config.NCPMS_SERVICE_CODES["insect_search"], **p)


def insect_detail(key: str, insect_key: str) -> list[dict]:
    """SVC07 해충 상세 → ecologyInfo, damageInfo, preventMethod, imageList …"""
    return call(key, config.NCPMS_SERVICE_CODES["insect_detail"], insectKey=insect_key)


# --- 예찰(SVC51~53): 회차 목록 → 시도별 → 시군구별 조사값 ---------------------------
def survey_search(key: str, year: int, predictn_code: str = "", kncr_code: str = "", display: int = 50, start: int = 1) -> list[dict]:
    """SVC51 예찰 회차 목록 → insectKey(회차 상세키), examinYear, kncrNm, examinSpchcknNm, examinTmrd, inputStdrDatetm.
    코드값(예찰구분·작물)은 data/reference/ncpms_survey_targets.csv."""
    p: dict[str, Any] = {"serviceType": XML, "searchExaminYear": str(year), "displayCount": display, "startPoint": start}
    if predictn_code:
        p["searchPredictnSpchcknCode"] = predictn_code
    if kncr_code:
        p["searchKncrCode"] = kncr_code
    return call(key, config.NCPMS_SERVICE_CODES["survey_search"], **p)


def survey_by_sido(key: str, insect_key: str) -> list[dict]:
    """SVC52 한 회차의 시도별 조사값 → sidoCode, sidoNm, dbyhsNm(병해충·지표명), inqireValue"""
    return call(key, config.NCPMS_SERVICE_CODES["survey_by_sido"], serviceType=XML, insectKey=insect_key)


def survey_by_sigungu(key: str, insect_key: str, sido_code: str) -> list[dict]:
    """SVC53 한 회차·시도의 시군구별 조사값 → sigunguNm, dbyhsNm, inqireValue"""
    return call(key, config.NCPMS_SERVICE_CODES["survey_by_sigungu"], serviceType=XML, insectKey=insect_key, sidoCode=sido_code)


def control_info(key: str, kind: str, ncpms_key: str) -> Optional[dict]:
    """모델 카드의 ncpms_key로 방제 정보를 받아 화면용 사전으로 정리. 실패하면 None."""
    try:
        rows = disease_detail(key, ncpms_key) if kind == "sick" else insect_detail(key, ncpms_key)
    except Exception as e:  # noqa: BLE001
        log.warning("NCPMS 방제정보 실패(%s %s): %s", kind, ncpms_key, e)
        return None
    if not rows:
        return None
    r = rows[0]
    # 태그명은 NCPMS OpenAPI 상세 명세(SVC05·SVC07) 기준(11-10 확인). 실응답으로 한 번 더 검증할 것.
    return {
        "name": r.get("sickNameKor") or r.get("insectSpeciesKor") or r.get("insectKorName") or "",
        "crop": r.get("cropName") or "",
        "environment": r.get("developmentCondition") or r.get("ecologyInfo") or "",
        "symptoms": r.get("symptoms") or r.get("damageInfo") or "",
        "control": r.get("preventionMethod") or r.get("preventMethod") or "",
        "image": r.get("imageList") or "",
        "raw": r,
    }


def save_control_cache(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
