"""농촌진흥청 토양도 기반 토양특성 통계정보 V2(data.go.kr 15144796) → 시군 토양 면적 분포 수집.

    python scripts/fetch_soil_stats.py [--keys survey|all] [--max-calls 800]

- 조회 단위: 법정동코드 10자리(시군구 5자리 + 00000). 코드는 최신 행정구역(2026 전남광주통합특별시 등) 기준이라
  시군 경계 원본(data/cache/boundary/HangJeongDong_*.geojson, scripts/build_sigungu_boundaries.py)의 sgg 코드를 쓴다.
  일반구가 있는 시(수원·청주 등)는 구별로 받아 합친다.
- 캐시: data/cache/soil/<op>/<코드>.xml (영구). 하루 호출 상한(--max-calls)에서 멈추고 다음 날 이어 받는다.
- 출력: data/reference/soil_stats_raw.json  {시군 키: {항목: {면적 필드: ha}}}
- 라이선스: 공공누리 제4유형(출처표시·상업적 이용금지·변경금지) — 모델 입력용, 원자료 재배포 금지
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pipeline import config, regions  # noqa: E402

BASE = "https://apis.data.go.kr/1390802/SoilEnviron/SoilCharacStat/V2/"
OPS = {
    "drain": "getSoilDrngGradSpecificInfo",        # 배수등급
    "depth": "getSoilValidSldpSpecificInfo",       # 유효토심
    "texture": "getSoilTopslSltxSpecificInfo",     # 표토토성
    "slope": "getSoilGrdntSpecificInfo",           # 경사
    "field_grade": "getSoilFieldGradSpecificInfo",  # 밭 적성등급
    "fruit_grade": "getSoilFruitGradSpecificInfo",  # 과수상전 적성등급
    "paddy_grade": "getSoilPaddyGradSpecificInfo",  # 논 적성등급
    "landuse": "getSoilMainLandSpecificInfo",      # 주토지이용
}
CACHE = config.CACHE_DIR / "soil"
OUT = config.DATA_DIR / "reference" / "soil_stats_raw.json"
BOUNDARY = sorted((config.DATA_DIR / "cache" / "boundary").glob("HangJeongDong_*.geojson"))
GU = re.compile(r"^(.+?시)(.+구)$")


def sgg_codes() -> dict[str, list[str]]:
    src = json.loads(BOUNDARY[-1].read_text(encoding="utf-8"))
    out: dict[str, set] = defaultdict(set)
    for f in src["features"]:
        p = f["properties"]
        sgg = p["sggnm"]
        m = GU.match(sgg)
        sg = m.group(1) if m else sgg
        sido = p["sidonm"]
        if sido.startswith("전남광주"):
            sido = "광주광역시" if sg.endswith("구") else "전라남도"
        out[regions.key_of(sido, sg)].add(p["sgg"])
    return {k: sorted(v) for k, v in out.items()}


def survey_keys() -> set[str]:
    from pipeline.survey_train import load_survey
    from pipeline.survey_trend import ITEMS

    keys: set[str] = set()
    for pest in ITEMS:
        try:
            keys |= {r["key"] for r in load_survey(pest)}
        except FileNotFoundError:
            pass
    return keys


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--keys", choices=["survey", "all"], default="survey")
    ap.add_argument("--max-calls", type=int, default=800)
    args = ap.parse_args(argv)
    key = config.data_go_kr_key()
    codes = sgg_codes()
    keys = sorted(survey_keys() if args.keys == "survey" else codes)
    calls = 0
    raw = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    stopped = False
    for k in keys:
        if k not in codes:
            print("경계에 없는 시군:", k)
            continue
        rec: dict[str, dict[str, float]] = {}
        for name, op in OPS.items():
            tot: dict[str, float] = defaultdict(float)
            got = False
            for c in codes[k]:
                p = CACHE / op / f"{c}.xml"
                if p.exists():
                    body = p.read_text(encoding="utf-8")
                else:
                    if calls >= args.max_calls:
                        stopped = True
                        break
                    url = BASE + op + "?" + urllib.parse.urlencode({"serviceKey": key, "STDG_CD": c + "00000"})
                    try:
                        with urllib.request.urlopen(url, timeout=30) as r:
                            body = r.read().decode("utf-8", "replace")
                    except Exception as e:  # noqa: BLE001 — 시간 초과 등은 건너뛰고 다음 실행에서 다시 받음
                        print("호출 실패", k, name, type(e).__name__)
                        continue
                    calls += 1
                    if "<result_Code>200" in body or "<result_Code>301" in body:
                        p.parent.mkdir(parents=True, exist_ok=True)
                        p.write_text(body, encoding="utf-8")
                for f, v in re.findall(r"<(\w+_Area)>([^<]*)</\1>", body):
                    try:
                        tot[f] += float(v)
                        got = True
                    except ValueError:
                        pass
            if stopped:
                break
            if got:
                rec[name] = dict(tot)
        if stopped:
            break
        if rec:
            raw[k] = rec
    OUT.write_text(json.dumps(raw, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"저장: {OUT} · 시군 {len(raw)}곳 · 이번 호출 {calls}건" + (" · 상한 도달(내일 이어 받기)" if stopped else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
