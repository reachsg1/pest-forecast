"""명령행 진입점.

  python -m pipeline.cli run [--date YYYY-MM-DD] [--horizon 10] [--demo] [--spots N] [--models id,id]
  python -m pipeline.cli probe            # 농업기상 API 응답 원문 확인(태그명 점검)
  python -m pipeline.cli spots            # 관측지점 목록 수집·저장
  python -m pipeline.cli models           # 등록된 모델 목록
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from models._base import DailyWeather  # noqa: E402
from models._base.registry import discover  # noqa: E402
from pipeline import config, survey_live  # noqa: E402
from pipeline.phenology import load_default as load_phenology  # noqa: E402
from pipeline.publish import publish  # noqa: E402
from pipeline.run_models import run_all  # noqa: E402
from pipeline.transform.interpolate import fill_gaps  # noqa: E402

log = logging.getLogger("pipeline")


def _parse_date(s: str | None) -> date:
    return datetime.strptime(s, "%Y-%m-%d").date() if s else date.today()


def cmd_models(_: argparse.Namespace) -> int:
    for m in discover(include_demo=True):
        c = m.card
        print(f"{c.id:28s} {c.type}  {c.crop:7s} {c.name_ko:12s} v{c.version} [{c.status}] {m.folder.relative_to(ROOT)}")
    return 0


def cmd_probe(_: argparse.Namespace) -> int:
    from pipeline.fetch.agriweather import probe

    key = config.data_go_kr_key()
    if not key:
        print("DATA_GO_KR_KEY 환경변수가 필요합니다.")
        return 2
    print(probe(key))
    return 0


def cmd_spots(_: argparse.Namespace) -> int:
    from pipeline.fetch.agriweather import fetch_spots

    key = config.data_go_kr_key()
    spots = fetch_spots(key)
    config.REFERENCE_DIR.mkdir(parents=True, exist_ok=True)
    out = config.REFERENCE_DIR / "spots.json"
    out.write_text(json.dumps(spots, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(spots)}개 지점 → {out}")
    if spots:
        print("첫 지점 원시 태그:", json.dumps(spots[0]["raw"], ensure_ascii=False))
    return 0


def _live_weather(spots: list[dict], issued: date, horizon: int, warnings: list[str]) -> dict[str, list[DailyWeather]]:
    from pipeline.fetch.agriweather import fetch_range_daily
    from pipeline.fetch.kma import MidForecaster, extend_forecast, fetch_vilage_fcst, latlon_to_grid

    key = config.data_go_kr_key()
    kkey = config.kma_key()
    start = date(issued.year, 1, 1)  # 적산온도 모델 때문에 연초부터
    out: dict[str, list[DailyWeather]] = {}
    mid = MidForecaster(kkey) if kkey else None
    mid_failed = False
    for i, sp in enumerate(spots, 1):
        code = sp["spot_code"]
        obs = fetch_range_daily(key, code, start, issued)
        fc: list[DailyWeather] = []
        if kkey and sp.get("lat") and sp.get("lon"):
            try:
                nx, ny = latlon_to_grid(float(sp["lat"]), float(sp["lon"]))
                fc = fetch_vilage_fcst(kkey, nx, ny)
            except Exception as e:  # noqa: BLE001
                warnings.append(f"{code} 단기예보 실패: {e}")
        mid_days: list = []
        if mid and not mid_failed and sp.get("lat") and sp.get("lon"):
            try:
                mid_days, _reg = mid.for_point(float(sp["lat"]), float(sp["lon"]))
            except Exception as e:  # noqa: BLE001
                mid_failed = True  # 승인 전·장애면 지점마다 다시 시도하지 않음
                warnings.append(f"중기예보 실패 — 단기예보 이후는 최근 평균으로 채움: {str(e)[:200]}")
        series = extend_forecast(obs, fc, issued + timedelta(days=horizon), mid=mid_days)
        out[code] = series
        log.info("[%d/%d] %s 관측 %d일, 단기예보 %d일, 중기예보 %d일", i, len(spots), code, len(obs), len(fc), len(mid_days))
    return out


def cmd_run(args: argparse.Namespace) -> int:
    issued = _parse_date(args.date)
    horizon = int(args.horizon)
    warnings: list[str] = []
    only = [x.strip() for x in args.models.split(",")] if args.models else None
    models = discover(only=only, include_demo=bool(args.demo))
    if not models:
        print("실행할 모델이 없습니다.")
        return 2

    if args.demo:
        from pipeline.demo import demo_phenology, demo_spots, demo_weather

        spots = demo_spots()
        weather = demo_weather(spots, issued, horizon)
        phen = demo_phenology()
        mode = "demo"
    else:
        spots_path = config.REFERENCE_DIR / "spots.json"
        if not spots_path.exists():
            print("data/reference/spots.json 이 없습니다. 먼저 `python -m pipeline.cli spots` 를 실행하세요.")
            return 2
        spots = json.loads(spots_path.read_text(encoding="utf-8"))
        spots = [s for s in spots if s.get("lat") and s.get("lon")]
        if args.spots:
            spots = spots[: int(args.spots)]
        weather = _live_weather(spots, issued, horizon, warnings)
        phen = load_phenology()
        mode = "live"

    crops = {m.card.crop for m in models}
    warnings.extend(phen.coverage_warnings(crops))
    phen_info = {
        "source": phen.label or "data/reference/cultivation.csv, crop_calendar.yaml",
        "min_area_ha": phen.min_area_ha,
        "cultivation_crops": sorted(phen.crops_with_cultivation() & crops),
        "calendar_crops": sorted(phen.crops_with_calendar() & crops),
    }

    missing: dict[str, float] = {}
    filled: dict[str, list[DailyWeather]] = {}
    for code, wx in weather.items():
        series, rate = fill_gaps(wx, end=issued + timedelta(days=horizon))
        filled[code] = series
        missing[code] = rate
    assessments: dict = {}
    # 예찰값을 쓰는 모델(예찰 학습형 + 직전 예찰)에 지점별 예찰 이력 — 운영은 NCPMS 실시간, 데모는 전년도 실제값
    survey_hist, survey_info = survey_live.build(models, spots, issued, mode, warnings)
    rows = run_all(spots, filled, models, issued, horizon, phenology=phen, assessments=assessments, survey_history=survey_hist)
    status = publish(rows, spots, filled, models, issued, horizon, missing, mode, warnings, assessments=assessments,
                     phenology_info=phen_info, survey_info=survey_info)
    print(json.dumps(status, ensure_ascii=False, indent=1))
    return 0 if status["ok"] else 1


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    p = argparse.ArgumentParser(prog="pipeline")
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run", help="일일 배치 실행")
    r.add_argument("--date", help="발행 기준일 YYYY-MM-DD (기본 오늘)")
    r.add_argument("--horizon", default=config.HORIZON_DAYS_DEFAULT)
    r.add_argument("--demo", action="store_true", help="합성 기상으로 실행(외부 API 불필요)")
    r.add_argument("--spots", help="앞에서 N개 지점만(트래픽 절약)")
    r.add_argument("--models", help="모델 id 쉼표 구분")
    r.set_defaults(fn=cmd_run)
    sub.add_parser("probe", help="농업기상 API 응답 원문 확인").set_defaults(fn=cmd_probe)
    sub.add_parser("spots", help="관측지점 목록 수집").set_defaults(fn=cmd_spots)
    sub.add_parser("models", help="모델 목록").set_defaults(fn=cmd_models)
    args = p.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())
