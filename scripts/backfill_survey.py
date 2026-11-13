"""NCPMS 예찰(모든 작물) 연도별 백필 — 하루 호출 상한 안에서 캐시를 채우고, 병해충별 CSV·연도별 추이를 갱신한다.

    python scripts/backfill_survey.py [--max-calls 700] [--years 2015-2026] [--crops 사과,고추(노지)]

- 기본 연도: 2015 ~ 마지막으로 끝난 예찰 시즌(11월부터는 올해, 그 전에는 지난해 — 진행 중인 시즌은 회차가 덜 차서 넣지 않는다).

- 우선순위(PRIORITY) 순서로 작물 × 연도를 돌며 회차·시도·시군 응답을 data/cache/ncpms/survey/ 에 캐시(영구).
  이미 받은 회차는 호출하지 않는다. 상한에 닿으면 멈추고 다음 날 이어 받는다(GitHub Actions survey-backfill.yml이 매일 실행).
- 캐시가 채워진 뒤 EXTRACT 의 병해충별 CSV(data/survey/ncpms_<pest>_sigungu.csv)를 다시 뽑는다(호출 없음).
- 작물 목록은 data/reference/ncpms_survey_targets.csv (NCPMS 예찰 대상 19개 작물·조사 구분).
"""
from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pipeline import config  # noqa: E402
from pipeline.fetch.survey import Budget, BudgetExceeded, SurveySpec, collect  # noqa: E402

# 서비스 중인 작물 먼저(사과·논벼·고추), 이후 확대 후보
PRIORITY = ["사과", "논벼", "고추(노지)", "배", "복숭아", "포도", "감귤", "콩", "배추(가을배추)", "무(가을무)", "양파",
            "마늘(난지)", "마늘(한지)", "감", "옥수수", "보리", "배추(여름배추)", "무(여름무)", "고추(시설)"]

# 병해충별 CSV로 뽑을 항목: pest_id → (작물군, 조사 항목에 포함될 글자). 정확한 항목명은 pipeline/survey_trend.ITEMS 가 거른다
EXTRACT = {
    "pepper_anthracnose": ("고추(노지)", "탄저병"),
    "pepper_phytophthora": ("고추(노지)", "역병"),
    "pepper_oriental_tobacco_budworm": ("고추(노지)", "담배나방"),
    "apple_anthracnose": ("사과", "탄저병"),
    "apple_oriental_fruit_moth": ("사과", "복숭아순나방"),
    "rice_leaf_blast": ("논벼", "잎도열병"),
    "rice_planthoppers": ("논벼", "멸구"),
    "rice_sheath_blight": ("논벼", "잎집무늬마름병"),
}


def targets() -> dict[str, SurveySpec]:
    p = config.DATA_DIR / "reference" / "ncpms_survey_targets.csv"
    out = {}
    with p.open(encoding="utf-8") as f:
        for r in csv.DictReader(f):
            out[r["crop_group"]] = SurveySpec(kncr=r["kncr_code"], examin=r["examin_spchckn_code"].zfill(5), item="",
                                              predictn=r["predictn_spchckn_code"].zfill(5))
    return out


def known_crop_years() -> set[tuple[str, int]]:
    out = set()
    for pest, (crop, _) in EXTRACT.items():
        p = config.DATA_DIR / "survey" / f"ncpms_{pest}_sigungu.csv"
        if p.exists():
            with p.open(encoding="utf-8") as f:
                out |= {(crop, int(r["year"])) for r in csv.DictReader(f)}
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-calls", type=int, default=700)
    ap.add_argument("--years", default=None, help="기본: 2015~마지막으로 끝난 시즌")
    ap.add_argument("--crops", default=None, help="쉼표로 구분한 작물군(기본: PRIORITY 전체)")
    ap.add_argument("--skip-known", action="store_true",
                    help="커밋된 병해충 CSV에 이미 있는 작물×연도는 건너뜀(캐시가 비어 있는 GitHub Actions용)")
    args = ap.parse_args(argv)
    if args.years:
        y0, y1 = (int(x) for x in args.years.split("-"))
    else:
        from datetime import date

        t = date.today()
        y0, y1 = 2015, (t.year if t.month >= 11 else t.year - 1)
    years = list(range(y1, y0 - 1, -1))  # 최근 연도부터
    key = config.ncpms_key()
    if not key:
        print("NCPMS_API_KEY 없음")
        return 1
    specs = targets()
    budget = Budget(args.max_calls)
    known = known_crop_years() if args.skip_known else set()
    done, stopped = [], None
    order = [c.strip() for c in args.crops.split(",")] if args.crops else PRIORITY
    for crop in order:
        spec = specs.get(crop)
        if spec is None:
            continue
        for y in years:
            if (crop, y) in known:
                continue
            try:
                collect(key, spec, [y], budget)
                done.append(f"{crop} {y}")
            except BudgetExceeded:
                stopped = f"{crop} {y}"
                break
            except Exception as e:  # noqa: BLE001 — 일시 오류는 다음 실행에서 다시
                print(f"오류 {crop} {y}: {type(e).__name__}")
        if stopped:
            break
    print(f"호출 {budget.used}건 · 완료 {len(done)}개(작물×연도)" + (f" · 상한 도달, 다음 시작: {stopped}" if stopped else " · 전체 완료"))

    # 병해충별 CSV 다시 뽑기(캐시만 사용, 호출 0)
    from dataclasses import replace

    nocall = Budget(0)
    for pest, (crop, item) in EXTRACT.items():
        spec = replace(specs[crop], item=item)
        rows = []
        for y in range(y0, y1 + 1):
            try:
                rows += collect(key, spec, [y], nocall)
            except BudgetExceeded:
                pass  # 아직 안 받은 회차는 건너뜀
        out = config.DATA_DIR / "survey" / f"ncpms_{pest}_sigungu.csv"
        # 이번에 뽑지 못한 연도(캐시에 없음)는 기존 CSV 행을 그대로 둔다
        got = {int(r["year"]) for r in rows}
        if out.exists():
            with out.open(encoding="utf-8") as f:
                rows += [r for r in csv.DictReader(f) if int(r["year"]) not in got]
        if not rows:
            continue
        rows.sort(key=lambda r: (int(r["year"]), r["survey_date"], r["sido_code"], r["sigungu_code"]))
        with out.open("w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(rows)
        yrs = sorted({int(r["year"]) for r in rows})
        print(f"  {pest}: {len(rows)}행 ({yrs[0]}~{yrs[-1]}, {len(yrs)}개 연도)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
