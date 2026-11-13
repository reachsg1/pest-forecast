"""기상청 ASOS(종관) 일자료 내려받기 — 모델 비교 검증용(분석용, 배치와 무관).

    python scripts/fetch_asos.py [--years 2015-2026] [--max-calls 2000]

- 지점: data/reference/asos_stations.csv (지점번호·지점명·시군 키)
- 서비스: 공공데이터포털 기상청_지상(종관, ASOS) 일자료 조회서비스(AsosDalyInfoService), 키는 DATA_GO_KR_KEY
- 캐시: data/cache/asos/daily/<지점>/<연도>.json (지난 해는 영구, 올해는 어제까지 다시 받음). 공공누리 1유형(출처: 기상청)
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
import time
import urllib.parse
import urllib.request
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from pipeline import config  # noqa: E402

URL = "http://apis.data.go.kr/1360000/AsosDalyInfoService/getWthrDataList"
CACHE = config.CACHE_DIR / "asos" / "daily"


def stations() -> list[dict]:
    with (config.DATA_DIR / "reference" / "asos_stations.csv").open(encoding="utf-8") as f:
        return list(csv.DictReader(f))


def fetch_year(key: str, stn: str, year: int) -> list[dict]:
    end = min(date(year, 12, 31), date.today() - timedelta(days=1))
    q = urllib.parse.urlencode({"serviceKey": key, "pageNo": 1, "numOfRows": 400, "dataType": "JSON", "dataCd": "ASOS", "dateCd": "DAY",
                                "startDt": f"{year}0101", "endDt": end.strftime("%Y%m%d"), "stnIds": stn})
    for attempt in range(3):
        try:
            d = json.loads(urllib.request.urlopen(f"{URL}?{q}", timeout=60).read().decode("utf-8"))
            h = d["response"]["header"]
            if h["resultCode"] == "03":  # NO_DATA
                return []
            if h["resultCode"] != "00":
                raise RuntimeError(h["resultMsg"])
            return d["response"]["body"]["items"]["item"] or []
        except Exception as e:  # noqa: BLE001
            if attempt == 2:
                raise RuntimeError(f"{stn} {year}: {type(e).__name__}") from None
            time.sleep(2)
    return []


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", default=f"2015-{date.today().year}")
    ap.add_argument("--max-calls", type=int, default=2000)
    ap.add_argument("--workers", type=int, default=8)
    a = ap.parse_args(argv)
    y0, y1 = (int(x) for x in a.years.split("-"))
    key = config.data_go_kr_key()
    todo = []
    for st in stations():
        for y in range(y0, y1 + 1):
            p = CACHE / st["stn_id"] / f"{y}.json"
            if not (p.exists() and y < date.today().year):
                todo.append((st["stn_id"], y, p))
    todo = todo[: a.max_calls]

    def job(t):
        stn, y, p = t
        try:
            rows = fetch_year(key, stn, y)
        except Exception as e:  # noqa: BLE001
            return f"오류 {e}"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
        return None

    from concurrent.futures import ThreadPoolExecutor

    with ThreadPoolExecutor(a.workers) as ex:
        errs = [e for e in ex.map(job, todo) if e]
    for e in errs[:10]:
        print(e)
    calls = len(todo)
    print(f"호출 {calls}건 완료")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
