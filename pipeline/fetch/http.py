"""재시도·타임아웃을 갖춘 GET과 XML 파싱 유틸."""
from __future__ import annotations

import logging
import time
import xml.etree.ElementTree as ET
from typing import Any, Optional

import requests

from .. import config

log = logging.getLogger(__name__)


class FetchError(RuntimeError):
    pass


def get(url: str, params: dict[str, Any], *, retries: int = config.RETRIES, timeout: int = config.REQUEST_TIMEOUT) -> requests.Response:
    last: Optional[Exception] = None
    for attempt in range(1, retries + 1):
        try:
            r = requests.get(url, params=params, timeout=timeout, headers={"User-Agent": "pest-forecast-pipeline/0.1"})
            if r.status_code == 200:
                return r
            last = FetchError(f"HTTP {r.status_code}: {r.text[:200]}")
        except requests.RequestException as e:  # noqa: PERF203
            last = e
        wait = config.RETRY_BACKOFF_SEC * attempt
        log.warning("GET %s 실패(%d/%d): %s — %.0fs 후 재시도", url, attempt, retries, last, wait)
        time.sleep(wait)
    raise FetchError(f"{url}: {last}")


def strip_ns(tag: str) -> str:
    return tag.split("}", 1)[1] if "}" in tag else tag


def xml_items(text: str, item_tag: str = "item") -> list[dict[str, str]]:
    """<item> 요소들을 {태그: 텍스트} 사전 목록으로. 공공데이터포털 공통 응답 구조 가정."""
    root = ET.fromstring(text)
    items: list[dict[str, str]] = []
    for el in root.iter():
        if strip_ns(el.tag) == item_tag:
            items.append({strip_ns(c.tag): (c.text or "").strip() for c in el})
    return items


def xml_header(text: str) -> dict[str, str]:
    """resultCode/resultMsg 등 헤더 추출(있으면)."""
    root = ET.fromstring(text)
    out: dict[str, str] = {}
    for el in root.iter():
        t = strip_ns(el.tag)
        if t in {"resultCode", "resultMsg", "result_Code", "result_Msg", "returnReasonCode", "returnAuthMsg", "errMsg"}:
            out[t] = (el.text or "").strip()
    return out


def pick(d: dict[str, str], candidates: list[str]) -> Optional[str]:
    """후보 태그 중 처음 존재하는 값을 돌려준다(대소문자 무시)."""
    lower = {k.lower(): v for k, v in d.items()}
    for c in candidates:
        if c in d and d[c] != "":
            return d[c]
        if c.lower() in lower and lower[c.lower()] != "":
            return lower[c.lower()]
    return None


def to_float(v: Optional[str]) -> Optional[float]:
    if v is None or v == "" or v in {"-", "null", "None"}:
        return None
    try:
        return float(v)
    except ValueError:
        return None
