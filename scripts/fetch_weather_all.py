"""농업기상 전국 전 지점 일자료를 월 단위로 받아 캐시(학습용 과거자료).

    python scripts/fetch_weather_all.py --years 2015-2025 --months 4-9

월 1회 호출(전국 약 150~210지점). 캐시: data/cache/agriweather/_all/YYYY-MM.json
API 키는 환경변수(DATA_GO_KR_KEY) 또는 루트 .env 에서 읽는다.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pipeline import config  # noqa: E402
from pipeline.fetch import agriweather  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", default="2015-2025")
    ap.add_argument("--months", default="4-9")
    args = ap.parse_args(argv)
    y0, y1 = (int(x) for x in args.years.split("-"))
    m0, m1 = (int(x) for x in args.months.split("-"))
    key = config.data_go_kr_key()
    for y in range(y0, y1 + 1):
        for m in range(m0, m1 + 1):
            rows = agriweather.fetch_month_all(key, y, m)
            print(f"{y}-{m:02d}: {len(rows)}행, {len({r.get('stn_Cd') for r in rows})}지점")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
