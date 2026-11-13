"""병해충별 방제 정보(행동 요령 + 등록 농약)를 미리 받아 정적 JSON으로 저장한다.

    python scripts/build_control_info.py

- 행동 요령: NCPMS 병·해충 상세(SVC05/SVC07)의 예방·약제·생물적 방제, 발생 환경, 증상 — 원문을 그대로(HTML 태그만 정리)
- 등록 농약: 농사로 OpenAPI 농약등록현황(pesticideRegStatus) — 작물×적용병해충의 품목·상표·회사·작용기작·용도·안전사용기준 확정 여부
- 사용 기준: 농약안전정보시스템(PSIS) OpenAPI SVC01(작물·병해충별 등록 농약) — 희석배수·사용 방법·사용 시기(수확 ○일 전)·사용 횟수.
  같은 품목·상표·회사면 농사로 행에 붙이고, 농사로에 없는 PSIS 품목은 새 행으로 더한다(키: PESTICIDE_KEY, 없으면 건너뜀)
- 출력: data/control/<pest_id>.json (커밋) → 배치 publish 가 apps/web/public/data/control/ 로 복사
- 출처 표시: "본 정보는 농촌진흥청의 농업기술포털 농사로(http://www.nongsaro.go.kr)에서 제공하고 있습니다", NCPMS
키: NCPMS_API_KEY, NONGSARO_API_KEY, PESTICIDE_KEY (.env). 호출 수: NCPMS 약 16건 + 농사로 3건 + PSIS 약 10건.
"""
from __future__ import annotations

import json
import re
import sys
import urllib.parse
import urllib.request
from collections import OrderedDict
from datetime import date
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pipeline import config  # noqa: E402
from pipeline.fetch import ncpms  # noqa: E402

OUT = config.DATA_DIR / "control"
NONGSARO_REG = "http://api.nongsaro.go.kr/service/pesticideRegStatus/pesticideRegStatusList"
PSIS = "https://psis.rda.go.kr/openApi/service.do"
ATTR_PSIS = "농촌진흥청 농약안전정보시스템(psis.rda.go.kr) 작물별 농약 사용기준"
ATTR_NONGSARO = "본 정보는 농촌진흥청의 농업기술포털 농사로(http://www.nongsaro.go.kr)에서 제공하고 있습니다."

# pest_id → NCPMS 검색(종류, 작물명, 이름 후보) · 농사로(작물 이름 패턴, 적용병해충 이름들)
PESTS = {
    "pepper_anthracnose": ("sick", "고추", ["탄저병"], r"^고추", ["탄저병"]),
    "pepper_phytophthora": ("sick", "고추", ["역병"], r"^고추", ["역병"]),
    "pepper_oriental_tobacco_budworm": ("insect", "고추", ["담배나방"], r"^고추", ["담배나방"]),
    "apple_anthracnose": ("sick", "사과", ["탄저병"], r"^사과", ["탄저병"]),
    "apple_oriental_fruit_moth": ("insect", "사과", ["복숭아순나방"], r"^사과", ["복숭아순나방"]),
    "rice_leaf_blast": ("sick", "벼", ["잎도열병", "도열병"], r"벼$|^벼", ["도열병", "잎도열병"]),
    "rice_planthoppers": ("insect", "벼", ["벼멸구", "흰등멸구"], r"벼$|^벼", ["벼멸구", "흰등멸구"]),
    "rice_sheath_blight": ("sick", "벼", ["잎집무늬마름병"], r"벼$|^벼", ["잎집무늬마름병"]),
}


def clean(html: str | None) -> str:
    if not html:
        return ""
    t = re.sub(r"<br\s*/?>", "\n", html, flags=re.I)
    t = re.sub(r"<[^>]+>", "", t)
    t = re.sub(r"&nbsp;", " ", t)
    t = re.sub(r"[ \t]+\n", "\n", t)
    return re.sub(r"\n{3,}", "\n\n", t).strip()


def env_key(name: str) -> str:
    import os

    v = os.environ.get(name, "")
    if v:
        return v.strip()
    p = ROOT / ".env"
    if p.exists():
        for line in p.read_text(encoding="utf-8").splitlines():
            if line.startswith(name + "="):
                return line.split("=", 1)[1].strip().strip('"')
    return ""


def ncpms_detail(key: str, kind: str, k: str) -> dict:
    """SVC05/SVC07 상세는 JSON(serviceType=AA003)으로 받는다 — {"service": {...}}"""
    from pipeline.fetch.http import get

    code = config.NCPMS_SERVICE_CODES["disease_detail" if kind == "sick" else "insect_detail"]
    params = {"apiKey": key, "serviceCode": code, "serviceType": "AA003", ("sickKey" if kind == "sick" else "insectKey"): k}
    r = get(config.NCPMS_BASE, params)
    try:
        return json.loads(r.text).get("service") or {}
    except ValueError:
        return {}


def ncpms_info(key: str, kind: str, crop: str, names: list[str]) -> list[dict]:
    out = []
    for nm in names:
        rows = ncpms.disease_search(key, crop_name=crop, disease_name=nm) if kind == "sick" else ncpms.insect_search(key, crop_name=crop, insect_name=nm)
        k = "sickKey" if kind == "sick" else "insectKey"
        exact = [r for r in rows if (r.get("sickNameKor") or r.get("insectKorName") or "") == nm] or rows[:1]
        if not exact or not exact[0].get(k):
            continue
        d = ncpms_detail(key, kind, exact[0][k])
        if not d:
            continue
        out.append({
            "name": nm,
            "ncpms_key": exact[0][k],
            "environment": clean(d.get("developmentCondition") or d.get("ecologyInfo")),
            "symptoms": clean(d.get("symptoms") or d.get("damageInfo")),
            "prevention": clean(d.get("preventionMethod") or d.get("preventMethod")),
            "chemical": clean(d.get("chemicalPrvnbeMth")),
            "biological": clean(d.get("biologyPrvnbeMth")),
        })
    return out


def nongsaro_reg(key: str, crop_word: str) -> list[dict]:
    q = urllib.parse.urlencode({"apiKey": key, "sType": "sCropsNm", "sText": crop_word, "pageNo": 1, "numOfRows": 3000})
    with urllib.request.urlopen(f"{NONGSARO_REG}?{q}", timeout=60) as r:
        root = ET.fromstring(r.read())
    return [{c.tag: (c.text or "").strip() for c in it} for it in root.iter("item")]


def psis_rows(key: str, crop: str, disease: str) -> list[dict]:
    """PSIS SVC01: 작물명·병해충명(부분 일치)으로 등록 농약 사용기준 전부(쪽 단위로)"""
    out: list[dict] = []
    start = 1
    while True:
        q = urllib.parse.urlencode({"apiKey": key, "serviceCode": "SVC01", "serviceType": "AA001", "cropName": crop,
                                    "diseaseWeedName": disease, "displayCount": 500, "startPoint": start})
        req = urllib.request.Request(f"{PSIS}?{q}", headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=60) as r:
            root = ET.fromstring(r.read())
        items = [{c.tag: (c.text or "").strip() for c in it} for it in root.iter("item")]
        out += items
        total = int(root.findtext("totalCount") or 0)
        if not items or len(out) >= total:
            return out
        start += len(items)


def main() -> int:
    nk, gk, pk = config.ncpms_key(), env_key("NONGSARO_API_KEY"), env_key("PESTICIDE_KEY")
    if not nk or not gk:
        print("NCPMS_API_KEY / NONGSARO_API_KEY 필요")
        return 1
    OUT.mkdir(parents=True, exist_ok=True)
    reg_cache: dict[str, list[dict]] = {}
    for pid, (kind, crop, names, crop_re, reg_names) in PESTS.items():
        info = ncpms_info(nk, kind, crop, names)
        if crop not in reg_cache:
            reg_cache[crop] = nongsaro_reg(gk, crop)
        rows = [r for r in reg_cache[crop] if re.search(crop_re, r.get("cropsNm", "")) and r.get("applcDbyhs", "") in reg_names]
        uniq: "OrderedDict[tuple, dict]" = OrderedDict()
        for r in rows:
            k = (r.get("prdlstNm"), r.get("brandNm"), r.get("cmpnyNm"))
            uniq.setdefault(k, {"product": r.get("prdlstNm", ""), "brand": r.get("brandNm", ""), "company": r.get("cmpnyNm", ""),
                                "moa": r.get("actnNm", ""), "use": r.get("prpos", ""), "crop": r.get("cropsNm", ""),
                                "target": r.get("applcDbyhs", ""), "status": r.get("dcsnAt", "")})
        # PSIS 사용 기준(희석배수·시기·횟수) 붙이기
        n_psis = 0
        if pk:
            prow: list[dict] = []
            for nm in reg_names:
                prow += [r for r in psis_rows(pk, crop, nm) if re.search(crop_re, r.get("cropName", "")) and r.get("diseaseWeedName", "") == nm]
            for r in prow:
                k = (r.get("pestiKorName"), r.get("pestiBrandName"), r.get("compName"))
                std = {"dilution": r.get("dilutUnit", "").replace(" -", "").strip(), "timing": r.get("useSuittime", ""),
                       "times": r.get("useNum", ""), "method": r.get("pestiUse", "")}
                if k in uniq:
                    if not uniq[k].get("timing"):
                        uniq[k].update(std)
                        n_psis += 1
                else:
                    uniq[k] = {"product": r.get("pestiKorName", ""), "brand": r.get("pestiBrandName", ""), "company": r.get("compName", ""),
                               "moa": r.get("indictSymbl", ""), "use": r.get("useName", ""), "crop": r.get("cropName", ""),
                               "target": r.get("diseaseWeedName", ""), "status": "확정", **std}
                    n_psis += 1
        doc = {
            "pest_id": pid,
            "generated": date.today().isoformat(),
            "ncpms": info,
            "pesticides": sorted(uniq.values(), key=lambda x: (x["moa"], x["product"], x["brand"])),
            "sources": {
                "ncpms": "국가농작물병해충관리시스템(NCPMS) 병해충 상세 정보",
                "pesticides": ATTR_NONGSARO + " (농약등록현황)" + (f" · {ATTR_PSIS}" if pk else ""),
            },
            "note": "희석배수·사용 시기·수확 전 사용일수·사용 횟수는 반드시 제품 라벨(안전사용기준)을 확인하세요.",
        }
        (OUT / f"{pid}.json").write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"{pid}: 요령 {len(info)}건 · 등록 농약 {len(doc['pesticides'])}종 · 사용기준(PSIS) {n_psis}종")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
