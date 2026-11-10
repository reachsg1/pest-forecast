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
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pipeline import config  # noqa: E402
from pipeline.fetch import ncpms  # noqa: E402

CACHE = config.CACHE_DIR / "ncpms" / "survey"


class Budget:
    def __init__(self, limit: int):
        self.limit, self.used = limit, 0

    def take(self) -> None:
        if self.used >= self.limit:
            raise SystemExit(f"호출 상한({self.limit}) 도달 — 캐시는 저장됨. 내일 같은 명령으로 이어 받으세요.")
        self.used += 1


def cached(path: Path, budget: Budget, fn):
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    budget.take()
    data = fn()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return data


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
    budget = Budget(args.max_calls)
    out_rows: list[dict] = []

    for year in range(y0, y1 + 1):
        rounds = cached(CACHE / f"rounds_{args.predictn}_{args.crop}_{year}.json", budget,
                        lambda: ncpms.survey_search(key, year, predictn_code=args.predictn, kncr_code=args.crop, display=100))
        rounds = [r for r in rounds if r.get("examinSpchcknCode") == args.examin]
        for rd in sorted(rounds, key=lambda r: int(r.get("examinTmrd") or 0)):
            ik = rd["insectKey"]
            sido_rows = cached(CACHE / ik / "sido.json", budget, lambda: ncpms.survey_by_sido(key, ik))
            sidos = sorted({(r["sidoCode"], r["sidoNm"]) for r in sido_rows if r.get("sidoCode")})
            for sc, sn in sidos:
                sg = cached(CACHE / ik / f"sgg_{sc}.json", budget, lambda: ncpms.survey_by_sigungu(key, ik, sc))
                for r in sg:
                    item = r.get("dbyhsNm", "")
                    if args.item not in item:
                        continue
                    d = rd.get("inputStdrDatetm", "")
                    out_rows.append({
                        "year": year, "round": rd.get("examinTmrd"),
                        "survey_date": f"{d[:4]}-{d[4:6]}-{d[6:8]}",
                        "sido_code": sc, "sido": sn,
                        "sigungu_code": r.get("sigunguCode", ""), "sigungu": r.get("sigunguNm", ""),
                        "item": item, "value": r.get("inqireValue", ""),
                    })
        print(f"{year}: 누적 {len(out_rows)}행, 호출 {budget.used}")

    out = config.DATA_DIR / "survey" / f"ncpms_{args.pest}_sigungu.csv"
    with out.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(out_rows[0].keys()) if out_rows else ["year"])
        w.writeheader()
        w.writerows(out_rows)
    print(f"저장: {out} ({len(out_rows)}행), 이번 실행 API 호출 {budget.used}건")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
