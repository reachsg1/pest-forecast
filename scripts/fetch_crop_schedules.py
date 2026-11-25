"""농사로 '작목별 농작업일정' API로 NCPMS 예찰 대상 작물의 생육·농작업 표를 받아 재배 기간 초안을 만든다.

    python scripts/fetch_crop_schedules.py [--crop 배,감귤] [--offline]

- 키: NONGSARO_WORKPLAN_KEY(.env). 작목 ↔ 번호(cntntsNo) 대응은 data/reference/nongsaro_schedules.csv
  (API 는 번호만 받고 작목명을 주지 않아, 농사로 화면 제목으로 117개를 대응시켜 둠. ncpms_crop 열이 있는 행만 받는다).
- 받은 표는 data/reference/crop_schedules/<cntntsNo>.json (라벨·칸 범위, 호출 없이 다시 쓸 수 있게),
  초안은 data/reference/crop_calendar_draft.yaml — crop_calendar.yaml 과 같은 형식, status: draft, 출처 URL 포함.
  crop_calendar.yaml 에는 자동으로 넣지 않는다(재배 기간 값은 담당 연구자 검토 대상, CLAUDE.md).
- 전국 기준 표라 권역별 시기(벼 이앙 등)는 따로 보완한다. 작기가 여러 개인 작물은 NCPMS 구분(여름·가을, 난지·한지)에 맞는 번호를 골라 둠.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import requests  # noqa: E402
import yaml  # noqa: E402

from pipeline import config  # noqa: E402
from pipeline.schedule import Cell, Table, derive_windows, parse_table  # noqa: E402

API = "http://api.nongsaro.go.kr/service/farmWorkingPlanNew/workScheduleEraInfoLst"
WEB = "https://www.nongsaro.go.kr/portal/ps/psb/psbl/workScheduleDtl.ps?menuId=PS00087&cntntsNo="
REF = config.DATA_DIR / "reference"
OUT_DIR = REF / "crop_schedules"
DRAFT = REF / "crop_calendar_draft.yaml"


def workplan_key() -> str:
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.startswith("NONGSARO_WORKPLAN_KEY="):
                return line.split("=", 1)[1].strip()
    import os

    return os.environ.get("NONGSARO_WORKPLAN_KEY", "")


def targets() -> list[dict]:
    with (REF / "nongsaro_schedules.csv").open(encoding="utf-8") as f:
        return [r for r in csv.DictReader(f) if r.get("ncpms_crop")]


def fetch_html(key: str, no: str) -> str:
    r = requests.get(API, params={"apiKey": key, "cntntsNo": no}, timeout=30)
    r.raise_for_status()
    m = re.search(r"<htmlCn><!\[CDATA\[(.*?)\]\]></htmlCn>", r.text, re.S)
    if not m:
        msg = re.search(r"<resultMsg>(.*?)</resultMsg>", r.text)
        raise RuntimeError(f"cntntsNo {no}: {msg.group(1) if msg else r.text[:120]}")
    return m.group(1)


def load_table(p: Path) -> Table:
    saved = json.loads(p.read_text(encoding="utf-8"))
    return Table(tuple(saved["months"]), tuple(tuple(Cell(*c) for c in r) for r in saved["rows"]))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--crop", default="", help="쉼표로 구분한 NCPMS 작물군(기본: 대응표 전체)")
    ap.add_argument("--offline", action="store_true", help="저장된 표만 써서 초안을 다시 만든다(호출 없음)")
    args = ap.parse_args(argv)
    key = "" if args.offline else workplan_key()
    if not args.offline and not key:
        print("NONGSARO_WORKPLAN_KEY 없음")
        return 1
    only = {c.strip() for c in args.crop.split(",") if c.strip()}
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    drafts: dict[str, dict] = {}
    for t in targets():
        crop, no = t["ncpms_crop"], t["cntntsNo"]
        if only and crop not in only:
            continue
        p = OUT_DIR / f"{no}.json"
        usable = p.exists() and "months" in json.loads(p.read_text(encoding="utf-8"))  # 옛 형식(달 순서 없음)은 다시 받는다
        if args.offline or usable:
            if not usable:
                print(f"  {crop}: 저장된 표 없음(건너뜀)")
                continue
            tb = load_table(p)
        else:
            tb = parse_table(fetch_html(key, no))
            p.write_text(json.dumps({"cntntsNo": no, "name": t["name"], "ncpms_crop": crop, "fetched": date.today().isoformat(),
                                     "months": list(tb.months), "rows": [[[c.label, c.start, c.end] for c in r] for r in tb.rows]},
                                    ensure_ascii=False, indent=1), encoding="utf-8")
        ws = derive_windows(tb)
        labels = " / ".join(", ".join(c.label for c in r) for r in tb.rows)
        if not ws:
            print(f"  {crop} ({t['name']} {no}): 정식·파종 또는 수확 칸을 못 찾음 — 표: {labels[:160]}")
            continue
        for w in ws:
            print(f"  {crop:10s} {w['start']} ~ {w['end']}  ← {w['start_basis']} · {w['end_basis']}  ({t['name']} {no})")
        drafts[crop] = {
            "label": crop, "nongsaro": f"{t['name']} ({no})", "table_starts": f"{tb.months[0]}월",
            "window_meaning": "작물이 포장에 있는 기간(정식·이앙·씨뿌림 ~ 수확 종료)",
            "windows": [{"level": "national", "region": "", "start": w["start"], "end": w["end"], "status": "draft",
                         "source": f"농촌진흥청 농사로 작목별 농작업일정-{t['name']}({w['start_basis']}, {w['end_basis']}) {WEB}{no}"} for w in ws],
            "review_note": "전국 기준 표. 작기가 여럿이면 NCPMS 구분(여름·가을, 난지·한지)에 맞는 것을 고르고, 권역별 시기·노지 여부는 담당 연구자 검토 후 crop_calendar.yaml 로 옮긴다.",
        }
    DRAFT.write_text(
        "# 재배 기간 초안 — scripts/fetch_crop_schedules.py 가 농사로 농작업일정 표에서 뽑음(자동, 검토 전).\n"
        "# crop_calendar.yaml 과 같은 형식. 검토를 거친 항목만 crop_calendar.yaml 로 옮길 것(근거 URL 유지).\n"
        f"# 생성 {date.today().isoformat()}\n"
        + yaml.safe_dump({"crops": drafts}, allow_unicode=True, sort_keys=False, width=200),
        encoding="utf-8",
    )
    print(f"초안 {len(drafts)}개 작물 → {DRAFT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
