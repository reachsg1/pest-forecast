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


def disease_search(key: str, crop_name: str = "", disease_name: str = "", display: int = 50) -> list[dict]:
    """SVC01 병 검색. cropName/sickNameKor 파라미터는 NCPMS 가이드 기준."""
    p: dict[str, Any] = {"displayCount": display}
    if crop_name:
        p["cropName"] = crop_name
    if disease_name:
        p["sickNameKor"] = disease_name
    return call(key, config.NCPMS_SERVICE_CODES["disease_search"], **p)


def disease_detail(key: str, sick_key: str) -> list[dict]:
    """SVC05 병 상세(발생환경·증상·방제법·사진). sickKey 예: D00001596"""
    return call(key, config.NCPMS_SERVICE_CODES["disease_detail"], sickKey=sick_key)


def insect_search(key: str, crop_name: str = "", insect_name: str = "", display: int = 50) -> list[dict]:
    p: dict[str, Any] = {"displayCount": display}
    if crop_name:
        p["cropName"] = crop_name
    if insect_name:
        p["insectKorName"] = insect_name
    return call(key, config.NCPMS_SERVICE_CODES["insect_search"], **p)


def insect_detail(key: str, insect_key: str) -> list[dict]:
    return call(key, config.NCPMS_SERVICE_CODES["insect_detail"], insectKey=insect_key)


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
    # 태그명은 NCPMS 가이드 기준 후보. 없으면 원문 사전을 그대로 둔다.
    return {
        "name": r.get("sickNameKor") or r.get("insectKorName") or "",
        "crop": r.get("cropName") or "",
        "environment": r.get("developmentCondition") or r.get("ecologyInfo") or "",
        "symptoms": r.get("symptoms") or r.get("damageInfo") or "",
        "control": r.get("preventionMethod") or r.get("preventMethod") or "",
        "image": r.get("imageList") or r.get("spcsImageList") or "",
        "raw": r,
    }


def save_control_cache(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
