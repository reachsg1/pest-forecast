"""농업경영체 등록정보(농작물 재배현황)에서 시군별 노지 재배면적을 받아 cultivation.csv 를 만든다.

원천: 농림축산식품부 농업경영체 등록정보 현황 서비스 > 농작물 재배현황 > 지역별 품목별 현황
      https://uni.agrix.go.kr/docs7/biOlap/fixType.do?reportId=eqpt_oudor_area_item
      (화면에서 경영체 구분=전체, 노지, 출력형태=시도·시군·중분류·소분류, 품목 선택 후 '조회'와 같은 요청)

출력
- data/reference/source/agrix_oudor_<연도>.csv  원자료(시도·시군구·중분류·소분류·면적·경영체수)
- data/reference/cultivation.csv               판정용(시군 단위로 합산, 작물 코드로 묶음)

주의(원천 안내문): 재배면적은 작기를 반영하므로 실제 경작면적보다 클 수 있고,
여러 지역을 경영하는 경영체가 있어 시도·시군 합계가 일치하지 않을 수 있다.

실행: python scripts/fetch_cultivation.py [--year 2025]
"""
from __future__ import annotations

import argparse
import csv
import sys
from collections import defaultdict
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
URL = "https://uni.agrix.go.kr/docs7/biOlap/search.do"
PAGE_URL = "https://uni.agrix.go.kr/docs7/biOlap/fixType.do?reportId=eqpt_oudor_area_item"
SOURCE = "농업경영체 등록정보 농작물 재배현황(노지, {year})"

# 품목코드 → 모델 crop. 고추는 노지 고추 계열(풋·꽈리·건·홍고추)을 합산.
# 제외: 밭벼·총체벼(사료), 고추냉이, 피망·파프리카, 화훼용 오색고추
ITEMS: dict[str, tuple[str, str]] = {
    "060100": ("apple", "사과"),
    "010100": ("rice", "벼"),
    "120500": ("pepper", "풋고추"),
    "120600": ("pepper", "꽈리고추"),
    "120700": ("pepper", "건고추"),
    "120800": ("pepper", "홍고추"),
}


def form(year: int, page: int, rows: int = 600) -> dict:
    # 이 서비스는 조회 조건을 변형된 문자열로 받는다(웹방화벽 회피용: AND→AAA, =→EEE, 끝에 W+AND 개수).
    codes = ", ".join(f"'{c}'" for c in ITEMS)
    cond = f"AAA ITM_CD IN ({codes}) AAA CRT_YEAR EEE '{year}' W2"
    return {
        "sidoType": "true", "siguType": "true", "ubmnType": "false",
        "highLevelType": "false", "mediumLevelType": "true", "lowLevelType": "true",
        "eqptBkindType": "false", "eqptMkindType": "false",
        "oudorType": "true", "eqptType": "false",
        "selAreaStr": "SK", "selItemStr": "S",
        "reportId": "eqpt_oudor_area_item", "searchYear": str(year), "condition": cond,
        "subject1": "농작물 재배현황", "subject2": "지역별 품목별 현황",
        "pageNo": str(page), "pageRows": str(rows),
    }


def fetch(year: int) -> list[dict]:
    s = requests.Session()
    s.headers.update({"User-Agent": "pest-forecast-batch/0.1", "X-Requested-With": "XMLHttpRequest", "Referer": PAGE_URL})
    s.get(PAGE_URL, timeout=30)  # 세션 쿠키
    out: list[dict] = []
    for page in range(1, 50):
        r = s.post(URL, data=form(year, page), timeout=60)
        r.raise_for_status()
        rows = r.json().get("result") or []
        out.extend(rows)
        if len(rows) < 600:
            break
    return [x for x in out if x.get("sclsCdNm")]  # 시군 소계 행(품목 없음) 제외


def city(sigungu: str) -> str:
    """'수원시 장안구' → '수원시'. 판정은 시군 단위로 한다(pipeline.phenology.region_key)."""
    return (sigungu or "").split()[0] if sigungu else ""


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--year", type=int, default=2025)
    args = ap.parse_args(argv)
    rows = fetch(args.year)
    if not rows:
        print("결과가 없습니다. 원천 화면에서 조회되는지 확인하세요:", PAGE_URL)
        return 1

    name_to_crop = {v[1]: v[0] for v in ITEMS.values()}
    src_dir = ROOT / "data" / "reference" / "source"
    src_dir.mkdir(parents=True, exist_ok=True)
    raw_path = src_dir / f"agrix_oudor_{args.year}.csv"
    with raw_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["year", "sido", "sigungu", "mcls", "item", "area_ha", "n_farms"])
        for x in rows:
            w.writerow([args.year, x["agrldSdNm"], x["agrldSkNm"], x["mclsCdNm"], x["sclsCdNm"], x["rlAgrldAra"], x["nagrldCnt"]])

    agg: dict[tuple[str, str, str], float] = defaultdict(float)
    unknown: set[str] = set()
    for x in rows:
        crop = name_to_crop.get(x["sclsCdNm"])
        if not crop:
            unknown.add(x["sclsCdNm"])
            continue
        agg[(x["agrldSdNm"], city(x["agrldSkNm"]), crop)] += float(x["rlAgrldAra"] or 0)

    out_path = ROOT / "data" / "reference" / "cultivation.csv"
    src = SOURCE.format(year=args.year)
    with out_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["year", "sido", "sigungu", "crop", "area_ha", "source"])
        for (sido, sg, crop), area in sorted(agg.items()):
            w.writerow([args.year, sido, sg, crop, round(area, 2), src])

    by_crop: dict[str, int] = defaultdict(int)
    for (_, _, c) in agg:
        by_crop[c] += 1
    print(f"원자료 {len(rows)}행 → {raw_path.relative_to(ROOT)}")
    print(f"판정용 {len(agg)}행(시군×작물) → {out_path.relative_to(ROOT)}  작물별 시군 수: {dict(by_crop)}")
    if unknown:
        print("매핑 안 된 품목:", sorted(unknown), file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
