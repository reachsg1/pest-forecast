"""결과를 웹 정적 JSON과 일별 스냅샷으로 발행한다.

apps/web/public/data/
  status.json            배치 상태
  spots.json             관측지점 목록
  pests.json             모델 카드 + 검증 요약
  summary.json           홈 대시보드용 요약(등급별 지점 수, 상위 위험 지점)
  risk/<pest_id>.json    지도용: 지점별 오늘~전망 지수 배열
  spot/<spot_code>.json  지점 패널·상세 추이용: 병해충별 일자 시계열 + 기상
data/predictions/YYYY-MM-DD.csv  (pyarrow가 있으면 .parquet도)
"""
from __future__ import annotations

import csv
import json
import logging
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path
from typing import Any

from models._base import GRADES, DailyWeather
from models._base.registry import LoadedModel

from . import config

log = logging.getLogger(__name__)

CROP_NAMES = {"rice": "벼", "apple": "사과", "pepper": "고추", "pear": "배", "peach": "복숭아"}


def _dump(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def _grade_counts(entries: list[dict], key: str = "grade_today") -> dict[str, int]:
    c = {g[0]: 0 for g in GRADES}
    for e in entries:
        c[e[key]] = c.get(e[key], 0) + 1
    return c


def publish(
    rows: list[dict],
    spots: list[dict],
    weather_by_spot: dict[str, list[DailyWeather]],
    models: list[LoadedModel],
    issued: date,
    horizon: int,
    missing_rate_by_spot: dict[str, float],
    mode: str,
    warnings: list[str],
    control_info: dict[str, Any] | None = None,
) -> dict[str, Any]:
    config.ensure_dirs()
    web = config.WEB_DATA_DIR
    spot_meta = {s["spot_code"]: s for s in spots}

    # --- spots.json ---------------------------------------------------------
    spots_out = [
        {
            "spot_code": s["spot_code"],
            "name": s["name"],
            "lat": s.get("lat"),
            "lon": s.get("lon"),
            "altitude": s.get("altitude"),
            "sigungu": s.get("sigungu", ""),
            "missing_rate": round(missing_rate_by_spot.get(s["spot_code"], 0.0), 3),
            "data_poor": missing_rate_by_spot.get(s["spot_code"], 0.0) > 0.3,
        }
        for s in spots
    ]
    _dump(web / "spots.json", spots_out)

    # --- pests.json ---------------------------------------------------------
    pests_out = []
    for lm in models:
        card = lm.card.to_dict()
        card["crop_ko"] = CROP_NAMES.get(lm.card.crop, lm.card.crop)
        card["eval"] = lm.eval_summary()
        if control_info and lm.card.pest_id in control_info:
            card["control"] = control_info[lm.card.pest_id]
        pests_out.append(card)
    _dump(web / "pests.json", pests_out)

    # --- 행 분류 -----------------------------------------------------------
    by_pest_spot: dict[str, dict[str, list[dict]]] = defaultdict(lambda: defaultdict(list))
    for r in rows:
        by_pest_spot[r["pest_id"]][r["spot_code"]].append(r)

    summary_pests = []
    for lm in models:
        pid = lm.card.pest_id
        entries = []
        for code, rs in by_pest_spot.get(pid, {}).items():
            rs.sort(key=lambda x: x["offset_days"])
            fut = [x for x in rs if 0 <= x["offset_days"] <= horizon]
            today = next((x for x in rs if x["offset_days"] == 0), None)
            if today is None:
                continue
            sm = spot_meta.get(code, {})
            entries.append(
                {
                    "spot_code": code,
                    "name": sm.get("name", code),
                    "lat": sm.get("lat"),
                    "lon": sm.get("lon"),
                    "sigungu": sm.get("sigungu", ""),
                    "data_poor": missing_rate_by_spot.get(code, 0.0) > 0.3,
                    "index_today": today["index"],
                    "grade_today": today["grade"],
                    "index_by_offset": [x["index"] for x in fut],      # 0..horizon
                    "grade_by_offset": [x["grade"] for x in fut],
                    "max_index_7d": max((x["index"] for x in fut if x["offset_days"] <= 7), default=today["index"]),
                    "max_index_10d": max((x["index"] for x in fut), default=today["index"]),
                }
            )
        entries.sort(key=lambda e: -e["index_today"])
        _dump(
            web / "risk" / f"{pid}.json",
            {
                "pest_id": pid,
                "name_ko": lm.card.name_ko,
                "crop": lm.card.crop,
                "issued_date": issued.isoformat(),
                "horizon_days": horizon,
                "offsets": list(range(0, horizon + 1)),
                "spots": entries,
            },
        )
        summary_pests.append(
            {
                "pest_id": pid,
                "name_ko": lm.card.name_ko,
                "crop": lm.card.crop,
                "crop_ko": CROP_NAMES.get(lm.card.crop, lm.card.crop),
                "type": lm.card.type,
                "in_season": lm.model.in_season(issued),
                "grade_counts": _grade_counts(entries),
                "max_grade": max((e["grade_today"] for e in entries), key=lambda g: [x[0] for x in GRADES].index(g), default="정상"),
                "top_spots": [{"spot_code": e["spot_code"], "name": e["name"], "index": e["index_today"], "grade": e["grade_today"]} for e in entries[:5]],
                "trend_7d": _national_trend(entries, 7),
            }
        )

    # --- spot/<code>.json ---------------------------------------------------
    for s in spots:
        code = s["spot_code"]
        series: dict[str, list[dict]] = {}
        for lm in models:
            rs = by_pest_spot.get(lm.card.pest_id, {}).get(code, [])
            if rs:
                series[lm.card.pest_id] = [
                    {"date": r["target_date"], "offset": r["offset_days"], "index": r["index"], "grade": r["grade"], "is_forecast": r["is_forecast"], "inputs": r["inputs"]}
                    for r in sorted(rs, key=lambda x: x["offset_days"])
                ]
        wx = [
            {
                "date": w.date.isoformat(),
                "tavg": _r(w.tavg),
                "tmax": _r(w.tmax),
                "tmin": _r(w.tmin),
                "rh": _r(w.rh),
                "rain": _r(w.rain),
                "lwd_hours": _r(w.estimated_lwd()),
                "sunshine": _r(w.sunshine),
                "is_forecast": w.is_forecast,
                "is_interpolated": w.is_interpolated,
            }
            for w in weather_by_spot.get(code, [])
            if abs((w.date - issued).days) <= max(config.HISTORY_DAYS_SHOWN, horizon)
        ]
        _dump(
            web / "spot" / f"{code}.json",
            {
                "spot": {k: v for k, v in s.items() if k != "raw"},
                "issued_date": issued.isoformat(),
                "missing_rate": round(missing_rate_by_spot.get(code, 0.0), 3),
                "series": series,
                "weather": wx,
            },
        )

    # --- summary.json / status.json -----------------------------------------
    all_entries = [e for lm in models for e in json.loads((web / "risk" / f"{lm.card.pest_id}.json").read_text(encoding="utf-8"))["spots"]]
    summary = {
        "issued_date": issued.isoformat(),
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "horizon_days": horizon,
        "mode": mode,
        "grade_counts_all": _grade_counts(all_entries),
        "n_spots": len(spots),
        "n_models": len(models),
        "pests": sorted(summary_pests, key=lambda p: -max(p["grade_counts"].get("경보", 0) * 100 + p["grade_counts"].get("주의보", 0) * 10 + p["grade_counts"].get("예보", 0), 0)),
    }
    _dump(web / "summary.json", summary)
    status = {
        "ok": True,
        "mode": mode,
        "issued_date": issued.isoformat(),
        "generated_at": summary["generated_at"],
        "n_spots": len(spots),
        "n_models": len(models),
        "n_rows": len(rows),
        "mean_missing_rate": round(sum(missing_rate_by_spot.values()) / len(missing_rate_by_spot), 3) if missing_rate_by_spot else None,
        "data_poor_spots": sorted(c for c, m in missing_rate_by_spot.items() if m > 0.3),
        "warnings": warnings,
        "grades": [{"name": g[0], "min": g[1], "max": g[2]} for g in GRADES],
    }
    _dump(web / "status.json", status)

    # --- 일별 스냅샷 -----------------------------------------------------------
    snap = config.PREDICTIONS_DIR / f"{issued.isoformat()}.csv"
    with snap.open("w", newline="", encoding="utf-8") as f:
        wr = csv.writer(f)
        wr.writerow(["spot_code", "pest_id", "model_id", "model_version", "issued_date", "target_date", "offset_days", "index", "grade", "is_forecast"])
        for r in rows:
            wr.writerow([r["spot_code"], r["pest_id"], r["model_id"], r["model_version"], r["issued_date"], r["target_date"], r["offset_days"], r["index"], r["grade"], int(r["is_forecast"])])
    try:
        import pandas as pd  # noqa: WPS433

        pd.read_csv(snap).to_parquet(snap.with_suffix(".parquet"), index=False)
    except Exception:  # noqa: BLE001  (pyarrow 없으면 CSV만)
        pass
    log.info("발행 완료: %d행, 지점 %d, 모델 %d → %s", len(rows), len(spots), len(models), web)
    return status


def _r(v: float | None, nd: int = 1) -> float | None:
    return None if v is None else round(v, nd)


def _national_trend(entries: list[dict], days: int) -> list[float]:
    """전국 평균 위험지수 추이(오늘~days일)."""
    if not entries:
        return []
    n = min(days + 1, min(len(e["index_by_offset"]) for e in entries))
    out = []
    for i in range(n):
        out.append(round(sum(e["index_by_offset"][i] for e in entries) / len(entries), 1))
    return out
