"""NCPMS 예찰조사(SVC51→52→53) 시군구별 조사값 수집.

예) 노지고추 탄저병(피해과율), 2015~2025:
    python scripts/fetch_survey.py --crop VC011205 --examin 01320 --item 탄저병 --pest pepper_anthracnose

- 응답은 data/cache/ncpms/survey/ 에 회차·시도 단위로 캐시한다(재실행 시 호출 없음).
- 개발계정 일 1,000건 제한 → --max-calls 로 상한을 두고, 넘으면 멈춘다. 다음 날 같은 명령으로 이어 받는다.
- 결과: data/survey/ncpms_<pest>_sigungu.csv
  (year, round, survey_date, sido_code, sido, sigungu_code, sigungu, item, value)
- API 키는 환경변수(NCPMS_API_KEY) 또는 루트 .env 에서 읽는다.
"""
from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pipeline import config  # noqa: E402
from pipeline.fetch.survey import Budget, BudgetExceeded, SurveySpec, collect  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--crop", required=True, help="작물 코드 kncr_code (예: VC011205 고추)")
    ap.add_argument("--examin", required=True, help="조사 구분 코드 (예: 01320 노지고추)")
    ap.add_argument("--predictn", default="00209", help="예찰 구분 코드 (00204 논벼, 00209 그 외)")
    ap.add_argument("--item", required=True, help="조사 항목명에 포함될 글자 (예: 탄저병)")
    ap.add_argument("--pest", required=True, help="출력 파일용 pest_id")
    ap.add_argument("--years", default="2015-2025")
    ap.add_argument("--max-calls", type=int, default=900)
    args = ap.parse_args(argv)

    key = config.ncpms_key()
    if not key:
        print("NCPMS_API_KEY 가 없습니다(.env 또는 환경변수).")
        return 2
    y0, y1 = (int(x) for x in args.years.split("-"))
    spec = SurveySpec(kncr=args.crop, examin=args.examin, item=args.item, predictn=args.predictn)
    budget = Budget(args.max_calls)
    try:
        out_rows = collect(key, spec, list(range(y0, y1 + 1)), budget)
    except BudgetExceeded as e:
        print(f"{e} — 캐시는 저장됨. 내일 같은 명령으로 이어 받으세요.")
        return 3

    out = config.DATA_DIR / "survey" / f"ncpms_{args.pest}_sigungu.csv"
    with out.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(out_rows[0].keys()) if out_rows else ["year"])
        w.writeheader()
        w.writerows(out_rows)
    print(f"저장: {out} ({len(out_rows)}행), 이번 실행 API 호출 {budget.used}건")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
