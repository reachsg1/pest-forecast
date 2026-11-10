"""농업기상 전국 전 지점 일자료를 월 단위로 받아 캐시(학습용 과거자료).

    python scripts/fetch_weather_all.py --years 2015-2025 --months 4-9

월 1회 호출(전국 약 150~210지점). 캐시: data/cache/agriweather/_all/YYYY-MM.json
--stations 를 주면 관측지점 상세정보(15073274)로 data/reference/agri_stations.csv(코드·주소·좌표)도 갱신한다.
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


def save_stations(key: str) -> None:
    import csv

    from pipeline.fetch.http import get, xml_items

    r = get(config.AGRI_SPOT_LIST, {"serviceKey": key, "Page_No": 1, "Page_Size": 1000})
    items = xml_items(r.text)
    cols = ["Obsr_Spot_Code", "Obsr_Spot_Nm", "Instl_Adres", "Instl_La", "Instl_Lo", "Instl_Al", "Clmt_Zone_Code", "Obsr_Begin_Datetm"]
    out = config.REFERENCE_DIR / "agri_stations.csv"
    with out.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["spot_code", "name", "address", "lat", "lon", "alt", "clmt_zone", "obs_begin"])
        for it in items:
            w.writerow([(it.get(c) or "").strip() for c in cols])
    print(f"관측지점 {len(items)}곳 → {out}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", default="2015-2025")
    ap.add_argument("--months", default="4-9")
    ap.add_argument("--stations", action="store_true", help="관측지점 목록(주소·좌표) CSV도 갱신")
    args = ap.parse_args(argv)
    if args.stations:
        save_stations(config.data_go_kr_key())
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
