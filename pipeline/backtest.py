"""백테스트: 과거 기상으로 모델을 돌리고 예찰조사와 비교해 eval.json을 갱신한다.

입력
- data/survey/survey.csv  (정제된 예찰조사; 컬럼: spot_code, pest_id, survey_date, occurred(0/1), severity)
- 과거 기상: data/cache/agriweather/<spot>/<YYYY-MM>.json (수집 캐시) 또는 --demo 합성 기상
지표
- hit_rate: 예찰 '발생' 날 ±lead 일 안에 모델이 주의보 이상을 냈는지
- precision/recall: 주의보 이상 vs 발생 여부(일 단위)
- lead_days: 발생일 이전 최초 주의보까지의 평균 일수
예찰 자료가 없으면 status=no_survey_data 로 기록만 남긴다.

실행: python -m pipeline.backtest [--demo] [--years 2023,2024,2025]
"""
from __future__ import annotations

import argparse
import csv
import json
import logging
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from models._base import DailyWeather  # noqa: E402
from models._base.registry import discover  # noqa: E402
from pipeline import config  # noqa: E402

log = logging.getLogger("backtest")
ALERT = {"주의보", "경보"}


def load_survey(path: Path) -> dict[tuple[str, str], list[tuple[date, int]]]:
    out: dict[tuple[str, str], list[tuple[date, int]]] = defaultdict(list)
    if not path.exists():
        return out
    with path.open(encoding="utf-8") as f:
        for r in csv.DictReader(f):
            try:
                d = datetime.strptime(r["survey_date"][:10], "%Y-%m-%d").date()
                out[(r["spot_code"], r["pest_id"])].append((d, int(float(r.get("occurred", 0)))))
            except (KeyError, ValueError):
                continue
    return out


def load_cached_weather(spot_code: str, year: int) -> list[DailyWeather]:
    from pipeline.fetch.agriweather import to_daily_weather

    rows: list[dict] = []
    for m in range(1, 13):
        p = config.CACHE_DIR / "agriweather" / spot_code / f"{year:04d}-{m:02d}.json"
        if p.exists():
            rows.extend(json.loads(p.read_text(encoding="utf-8")))
    return to_daily_weather(rows)


def evaluate(pred: list, obs: list[tuple[date, int]], lead: int = 7) -> dict:
    by_date = {p.date: p for p in pred}
    tp = fp = fn = tn = 0
    leads: list[int] = []
    for d, occ in obs:
        alert_window = [by_date[d - timedelta(days=k)] for k in range(0, lead + 1) if (d - timedelta(days=k)) in by_date]
        alerted = any(p.grade in ALERT for p in alert_window)
        if occ and alerted:
            tp += 1
            first = next((k for k in range(lead, -1, -1) if (d - timedelta(days=k)) in by_date and by_date[d - timedelta(days=k)].grade in ALERT), 0)
            leads.append(first)
        elif occ and not alerted:
            fn += 1
        elif not occ and alerted:
            fp += 1
        else:
            tn += 1
    n = tp + fp + fn + tn
    return {
        "n_obs": n,
        "hit_rate": round((tp + tn) / n, 3) if n else None,
        "precision": round(tp / (tp + fp), 3) if (tp + fp) else None,
        "recall": round(tp / (tp + fn), 3) if (tp + fn) else None,
        "mean_lead_days": round(sum(leads) / len(leads), 1) if leads else None,
        "confusion": {"tp": tp, "fp": fp, "fn": fn, "tn": tn},
    }


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO)
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", default="2023,2024,2025")
    ap.add_argument("--demo", action="store_true", help="합성 기상으로 파이프라인 동작만 확인")
    ap.add_argument("--survey", default=str(config.DATA_DIR / "survey" / "survey.csv"))
    args = ap.parse_args(argv)
    years = [int(y) for y in args.years.split(",")]
    survey = load_survey(Path(args.survey))
    models = discover()
    for lm in models:
        result: dict = {"model_id": lm.id, "version": lm.card.version, "evaluated_at": datetime.now().isoformat(timespec="seconds"), "years": {}}
        if not survey:
            result["status"] = "no_survey_data"
            result["note"] = "data/survey/survey.csv 가 없어 비교하지 못함. 예찰조사 적재 후 다시 실행."
        else:
            spots = sorted({s for (s, p) in survey if p == lm.card.pest_id})
            for y in years:
                agg = {"tp": 0, "fp": 0, "fn": 0, "tn": 0}
                leads: list[float] = []
                for code in spots:
                    if args.demo:
                        from pipeline.demo import synth_weather

                        wx = synth_weather({"spot_code": code, "lat": 36.0}, date(y, 1, 1), date(y, 12, 31), date(y, 12, 31))
                    else:
                        wx = load_cached_weather(code, y)
                    if not wx:
                        continue
                    pred = lm.model.predict(wx)
                    obs = [(d, o) for d, o in survey[(code, lm.card.pest_id)] if d.year == y]
                    if not obs:
                        continue
                    ev = evaluate(pred, obs)
                    for k in agg:
                        agg[k] += ev["confusion"][k]
                    if ev["mean_lead_days"] is not None:
                        leads.append(ev["mean_lead_days"])
                n = sum(agg.values())
                result["years"][str(y)] = {
                    "n_obs": n,
                    "hit_rate": round((agg["tp"] + agg["tn"]) / n, 3) if n else None,
                    "precision": round(agg["tp"] / (agg["tp"] + agg["fp"]), 3) if (agg["tp"] + agg["fp"]) else None,
                    "recall": round(agg["tp"] / (agg["tp"] + agg["fn"]), 3) if (agg["tp"] + agg["fn"]) else None,
                    "mean_lead_days": round(sum(leads) / len(leads), 1) if leads else None,
                    "confusion": agg,
                }
            result["status"] = "evaluated"
        (lm.folder / "eval.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        log.info("%s: %s", lm.id, result["status"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
