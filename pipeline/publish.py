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
    """등급별 지점 수. '해당 없음'(grade=None)은 등급이 아니므로 세지 않는다."""
    c = {g[0]: 0 for g in GRADES}
    for e in entries:
        if e[key] is not None:
            c[e[key]] = c.get(e[key], 0) + 1
    return c


def _max_or_none(vals) -> float | None:
    vals = [v for v in vals if v is not None]
    return max(vals) if vals else None


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
    assessments: dict[tuple[str, str], Any] | None = None,
    phenology_info: dict[str, Any] | None = None,
    survey_info: dict[str, Any] | None = None,
) -> dict[str, Any]:
    assessments = assessments or {}
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

    # --- 병해충별 모델 묶음 -------------------------------------------------
    # 같은 pest_id의 모델이 여러 개일 수 있다. 기본 모델(is_default, 없으면 첫 모델)이
    # 홈 요약·등급 집계·risk/<pest_id>.json을 맡고, 모든 모델은 risk/models/<model_id>.json을 갖는다.
    pest_models: dict[str, list[LoadedModel]] = {}
    for lm in models:
        pest_models.setdefault(lm.card.pest_id, []).append(lm)
    # 지정한 기본 모델(예: 앙상블)이 이번 실행에서 결과를 못 냈으면 병해충 폴더의 원래 모델로 되돌린다
    ran = {r["model_id"] for r in rows}
    for pid, lst in pest_models.items():
        dflt = next((m for m in lst if m.is_default), None)
        if dflt is not None and not dflt.is_base and dflt.id not in ran and rows:
            base = next((m for m in lst if m.is_base), None)
            if base is not None:
                warnings.append(f"{pid}: 기본 모델 {dflt.id} 결과가 없어 {base.id}를 기본으로 발행")
                dflt = base
        lst.sort(key=lambda m: (m is not dflt, not m.is_base, m.id))
    default_of = {pid: lst[0] for pid, lst in pest_models.items()}
    base_of = {pid: next((m for m in lst if m.is_base), lst[0]) for pid, lst in pest_models.items()}

    # --- pests.json (병해충 1건 = 기본 모델 카드 + 모델 목록) ---------------------
    pests_out = []
    for pid, lst in pest_models.items():
        lm = lst[0]
        card = lm.card.to_dict()
        # 병해충 자체 정보(학명·도감 키 등)는 병해충 폴더 모델 카드 기준
        bc = base_of[pid].card
        for k in ("name_ko", "name_sci", "kind", "crop", "ncpms_key", "ncpms_kind"):
            if getattr(bc, k, ""):
                card[k] = getattr(bc, k)
        card["crop_ko"] = CROP_NAMES.get(lm.card.crop, lm.card.crop)
        card["eval"] = lm.eval_summary()
        card["default_model"] = lm.id
        card["models"] = [
            {**m.card.to_dict(), "model_id": m.id, "label": m.label, "is_default": m is lm, "eval": m.eval_summary()}
            for m in lst
        ]
        if control_info and pid in control_info:
            card["control"] = control_info[pid]
        pests_out.append(card)
    _dump(web / "pests.json", pests_out)

    # --- 행 분류 (모델별) -------------------------------------------------------
    by_model_spot: dict[str, dict[str, list[dict]]] = defaultdict(lambda: defaultdict(list))
    for r in rows:
        by_model_spot[r["model_id"]][r["spot_code"]].append(r)

    summary_pests = []
    for lm in models:
        pid = lm.card.pest_id
        is_default = default_of[pid] is lm
        entries = []
        for code, rs in by_model_spot.get(lm.id, {}).items():
            rs.sort(key=lambda x: x["offset_days"])
            fut = [x for x in rs if 0 <= x["offset_days"] <= horizon]
            today = next((x for x in rs if x["offset_days"] == 0), None)
            if today is None:
                continue
            sm = spot_meta.get(code, {})
            sc = assessments.get((code, lm.card.crop))
            entries.append(
                {
                    "spot_code": code,
                    "name": sm.get("name", code),
                    "lat": sm.get("lat"),
                    "lon": sm.get("lon"),
                    "sigungu": sm.get("sigungu", ""),
                    "data_poor": missing_rate_by_spot.get(code, 0.0) > 0.3,
                    "index_today": today["index"],                       # None = 해당 없음
                    "grade_today": today["grade"],
                    "na_today": today.get("na_reason"),                  # not_grown | off_season | None
                    "index_by_offset": [x["index"] for x in fut],      # 0..horizon
                    "grade_by_offset": [x["grade"] for x in fut],
                    "na_by_offset": [x.get("na_reason") for x in fut],
                    "max_index_7d": _max_or_none(x["index"] for x in fut if x["offset_days"] <= 7),
                    "max_index_10d": _max_or_none(x["index"] for x in fut),
                    "phenology": sc.to_dict() if sc is not None else None,
                    # 예찰값을 쓰는 모델: 오늘 계산에 쓴 예찰(시군·날짜·값·대체 거리)
                    "survey_ref": (today.get("inputs") or {}).get("survey_ref"),
                }
            )
        # 위험 높은 순, 해당 없음은 맨 뒤
        entries.sort(key=lambda e: (e["index_today"] is None, -(e["index_today"] or 0)))
        applicable = [e for e in entries if e["index_today"] is not None]
        risk_doc = {
            "pest_id": pid,
            "model_id": lm.id,
            "model_label": lm.label,
            "model_type": lm.card.type,
            "is_default": is_default,
            "name_ko": lm.card.name_ko,
            "crop": lm.card.crop,
            "issued_date": issued.isoformat(),
            "horizon_days": horizon,
            "offsets": list(range(0, horizon + 1)),
            "spots": entries,
        }
        if survey_info and lm.id in survey_info:
            risk_doc["survey"] = {k: v for k, v in survey_info[lm.id].items() if k != "spots"}
        _dump(web / "risk" / "models" / f"{lm.id}.json", risk_doc)  # 지도에서 모델을 골라 볼 때
        if not is_default:
            continue
        _dump(web / "risk" / f"{pid}.json", risk_doc)  # 기본 모델(요약·상세·API 호환)
        summary_pests.append(
            {
                "pest_id": pid,
                "name_ko": lm.card.name_ko,
                "crop": lm.card.crop,
                "crop_ko": CROP_NAMES.get(lm.card.crop, lm.card.crop),
                "type": lm.card.type,
                "in_season": lm.model.in_season(issued),
                "grade_counts": _grade_counts(entries),
                "na_count": len(entries) - len(applicable),
                "n_applicable": len(applicable),
                # 모든 지점이 해당 없음이면 None
                "max_grade": max((e["grade_today"] for e in applicable), key=lambda g: [x[0] for x in GRADES].index(g), default=None),
                "top_spots": [{"spot_code": e["spot_code"], "name": e["name"], "index": e["index_today"], "grade": e["grade_today"]} for e in applicable[:5]],
                "trend_7d": _national_trend(entries, 7),
            }
        )

    # --- 지난 실행이 남긴 파일 정리(데모↔실데이터 전환, 모델 삭제 시 섞이지 않게) ----------
    keep_spots = {f"{s['spot_code']}.json" for s in spots}
    for p in (web / "spot").glob("*.json"):
        if p.name not in keep_spots:
            p.unlink()
    keep_models = {f"{m.id}.json" for m in models}
    for p in (web / "risk" / "models").glob("*.json"):
        if p.name not in keep_models:
            p.unlink()
    keep_pests = {f"{pid}.json" for pid in pest_models}
    for p in (web / "risk").glob("*.json"):
        if p.name not in keep_pests:
            p.unlink()

    # --- 예찰 기반 정적 자료 복사(배치가 다시 만들지 않음) ----------------------------------
    #  backtest/<pest>.json: 과거 예찰 회차 되돌려 보기(pipeline/survey_backtest.py)
    #  trend/<pest>.json   : 연도별 발생 추이(pipeline/survey_trend.py)
    for sub in ("backtest", "trend"):
        src_dir = config.DATA_DIR / sub
        (web / sub).mkdir(parents=True, exist_ok=True)
        for p in (web / sub).glob("*.json"):
            if p.stem not in pest_models or not (src_dir / p.name).exists():
                p.unlink()
        for pid in pest_models:
            src = src_dir / f"{pid}.json"
            if src.exists():
                (web / sub / src.name).write_bytes(src.read_bytes())

    # --- spot/<code>.json ---------------------------------------------------
    for s in spots:
        code = s["spot_code"]
        series: dict[str, list[dict]] = {}          # pest_id → 기본 모델 시계열
        series_by_model: dict[str, list[dict]] = {}  # model_id → 추가 모델 시계열(기본 모델은 series에)
        for lm in models:
            rs = by_model_spot.get(lm.id, {}).get(code, [])
            if not rs:
                continue
            pts = [
                {"date": r["target_date"], "offset": r["offset_days"], "index": r["index"], "grade": r["grade"], "na_reason": r.get("na_reason"),
                 "is_forecast": r["is_forecast"], "inputs": r["inputs"]}
                for r in sorted(rs, key=lambda x: x["offset_days"])
            ]
            if default_of[lm.card.pest_id] is lm:
                series[lm.card.pest_id] = pts
            else:
                series_by_model[lm.id] = pts
        phen = {crop: sc.to_dict() for (c, crop), sc in assessments.items() if c == code}
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
                "phenology": phen,   # 작물별 재배 여부·재배 기간 판정 근거
                "series": series,
                "series_by_model": series_by_model,
                "weather": wx,
            },
        )

    # --- summary.json / status.json -----------------------------------------
    all_entries = [e for pid in pest_models for e in json.loads((web / "risk" / f"{pid}.json").read_text(encoding="utf-8"))["spots"]]
    summary = {
        "issued_date": issued.isoformat(),
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "horizon_days": horizon,
        "mode": mode,
        "grade_counts_all": _grade_counts(all_entries),
        "na_all": sum(1 for e in all_entries if e["index_today"] is None),
        "n_spots": len(spots),
        "n_models": len(pest_models),      # 화면의 '병해충 N종'(병해충 수)
        "n_model_variants": len(models),   # 추가 모델 포함 전체 모델 수
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
        "n_pests": len(pest_models),
        "n_rows": len(rows),
        "mean_missing_rate": round(sum(missing_rate_by_spot.values()) / len(missing_rate_by_spot), 3) if missing_rate_by_spot else None,
        "data_poor_spots": sorted(c for c, m in missing_rate_by_spot.items() if m > 0.3),
        "warnings": warnings,
        "grades": [{"name": g[0], "min": g[1], "max": g[2]} for g in GRADES],
        "phenology": phenology_info or {},
        "survey": {mid: {k: v for k, v in inf.items() if k != "spots"} for mid, inf in (survey_info or {}).items()},
    }
    _dump(web / "status.json", status)

    # --- 일별 스냅샷 -----------------------------------------------------------
    snap = config.PREDICTIONS_DIR / f"{issued.isoformat()}.csv"
    with snap.open("w", newline="", encoding="utf-8") as f:
        wr = csv.writer(f)
        wr.writerow(["spot_code", "pest_id", "model_id", "model_version", "issued_date", "target_date", "offset_days", "index", "grade", "is_forecast", "na_reason", "raw_index"])
        for r in rows:
            wr.writerow([r["spot_code"], r["pest_id"], r["model_id"], r["model_version"], r["issued_date"], r["target_date"], r["offset_days"],
                         "" if r["index"] is None else r["index"], r["grade"] or "", int(r["is_forecast"]), r.get("na_reason") or "", r.get("raw_index", "")])
    try:
        import pandas as pd  # noqa: WPS433

        pd.read_csv(snap).to_parquet(snap.with_suffix(".parquet"), index=False)
    except Exception:  # noqa: BLE001  (pyarrow 없으면 CSV만)
        pass
    log.info("발행 완료: %d행, 지점 %d, 모델 %d → %s", len(rows), len(spots), len(models), web)
    return status


def _r(v: float | None, nd: int = 1) -> float | None:
    return None if v is None else round(v, nd)


def _national_trend(entries: list[dict], days: int) -> list[float | None]:
    """전국 평균 위험지수 추이(오늘~days일). 그날 해당 없음인 지점은 평균에서 뺀다."""
    if not entries:
        return []
    n = min(days + 1, min(len(e["index_by_offset"]) for e in entries))
    out: list[float | None] = []
    for i in range(n):
        vals = [e["index_by_offset"][i] for e in entries if e["index_by_offset"][i] is not None]
        out.append(round(sum(vals) / len(vals), 1) if vals else None)
    return out
