"""예찰 학습형(유형 C) 모델 학습·검증 — NCPMS 시군구 예찰값 × 같은 시군 농업기상 관측소.

    python -m pipeline.survey_train --pest pepper_anthracnose --train 2015-2022 --test 2023-2025

입력
- data/survey/ncpms_<pest>_sigungu.csv  (scripts/fetch_survey.py)
- data/cache/agriweather/_all/YYYY-MM.json (scripts/fetch_weather_all.py)

매칭: 관측소 설치 주소(data/reference/agri_stations.csv, 관측지점 상세정보 15073274)의 '시도 시군'과
예찰의 '시도 시군'이 같으면 짝짓고, 시군 안 관측소가 여럿이면 날짜별 평균을 쓴다. 목록에 없는 옛
관측소는 이름 첫 낱말로 시군을 정한다. 관측소가 없는 시군은 뺀다(인접 시군 대체는 하지 않음).

정답: 조사값 > 0 → 발생(1). 피처는 조사일 전날까지의 기상(models._base.stat.compute_features).
검증은 연도 단위로 나눠(학습/시험 연도 분리) 다음과 비교한다.
- 기후값: 학습 연도의 '조사 회차(월·반월)'별 발생률
- 기본 모델: 현재 기본 모델(규칙형)의 그날 위험지수
- 예찰 학습형(로지스틱): 실제 배포 경로(StatModel.score, z ±3 절단)로 계산한 확률
- 참고: 비선형(HistGradientBoosting) — 같은 피처로 비선형이 얼마나 더 나은지 보기 위한 상한 참고치(배포 안 함)

결과: data/survey/eval_<pest>_survey.json (+ 표준출력 요약). model.yaml params 후보도 함께 낸다.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path
from statistics import mean

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from models._base.interface import DailyWeather  # noqa: E402
from models._base.registry import discover  # noqa: E402
from models._base.stat import compute_features  # noqa: E402
from pipeline import config  # noqa: E402
from pipeline.fetch.agriweather import to_daily_weather  # noqa: E402
from pipeline.phenology import norm_sido, region_key  # noqa: E402

STATIONS_CSV = config.REFERENCE_DIR / "agri_stations.csv"  # 관측지점 상세정보(15073274): 코드·주소·좌표

FEATURES = [
    "tavg_14d", "rh_14d", "rain_14d", "rain_days_14d", "lwd_14d", "lwd_30d",
    "tmin_7d", "rain_days_season", "wet_warm_days_season", "doy",
]
WINDOW_DAYS = 150  # 시즌 피처(6/1 이후)를 9월 말까지 담을 길이


def _years(s: str) -> list[int]:
    a, b = (int(x) for x in s.split("-"))
    return list(range(a, b + 1))


# 관측소 설치 주소가 옛 행정구역명으로 남은 경우 → 현재 시군(예찰 자료 표기)
# 여주군→여주시(2013.9 시 승격), 당진군→당진시(2012.1 시 승격), 청원군→청주시(2014.7 통합)
ADMIN_RENAMES = {"여주군": "여주시", "당진군": "당진시", "청원군": "청주시"}


def station_regions() -> dict[str, str]:
    """관측소 코드 → '시도 시군'(예: '경기 이천시'). 관측지점 상세정보의 설치 주소 기준."""
    out: dict[str, str] = {}
    if STATIONS_CSV.exists():
        with STATIONS_CSV.open(encoding="utf-8") as f:
            for r in csv.DictReader(f):
                sd, sg = region_key(r["address"])
                sg = ADMIN_RENAMES.get(sg, sg)
                if sd and sg:
                    out[r["spot_code"]] = f"{sd} {sg}"
    return out


def load_weather_by_sigungu(years: list[int], extra_regions: list[str] | None = None) -> dict[str, dict[date, DailyWeather]]:
    """'시도 시군' → 날짜 → 시군 내 관측소 평균 DailyWeather.

    관측소 시군은 관측지점 상세정보의 설치 주소로 정한다. 목록에 없는(폐쇄 등) 관측소는
    관측소명 첫 낱말을 시군으로 보고, 그 이름이 (관측소 주소·예찰 자료를 통틀어) 한 시도에만
    있을 때만 그 시도로 정한다."""
    regions = station_regions()
    sidos_of: dict[str, set] = defaultdict(set)
    for key in list(regions.values()) + list(extra_regions or []):
        sd, sg = key.split(" ", 1)
        sidos_of[sg].add(sd)
    raw_by_stn: dict[str, list[dict]] = defaultdict(list)
    stn_sgg: dict[str, str] = {}
    for y in years:
        for m in range(1, 13):
            p = config.CACHE_DIR / "agriweather" / "_all" / f"{y:04d}-{m:02d}.json"
            if not p.exists():
                continue
            for r in json.loads(p.read_text(encoding="utf-8")):
                code = r.get("stn_Cd")
                if not code:
                    continue
                raw_by_stn[code].append(r)
                if code in regions:
                    stn_sgg[code] = regions[code]
                else:
                    name = (r.get("stn_Name") or "").split()
                    sg = name[0] if name else ""
                    stn_sgg[code] = f"{next(iter(sidos_of[sg]))} {sg}" if len(sidos_of.get(sg, ())) == 1 else ""
    per_sgg_day: dict[str, dict[date, list[DailyWeather]]] = defaultdict(lambda: defaultdict(list))
    for code, rows in raw_by_stn.items():
        sgg = stn_sgg.get(code, "")
        if not sgg:
            continue
        for w in to_daily_weather(rows):
            per_sgg_day[sgg][w.date].append(w)

    def avg(ws: list[DailyWeather], attr: str):
        v = [getattr(w, attr) for w in ws if getattr(w, attr) is not None]
        return mean(v) if v else None

    out: dict[str, dict[date, DailyWeather]] = {}
    for sgg, days in per_sgg_day.items():
        out[sgg] = {
            d: DailyWeather(date=d, **{a: avg(ws, a) for a in ("tavg", "tmax", "tmin", "rh", "rain", "lwd_hours", "sunshine", "radiation", "wind")})
            for d, ws in days.items()
        }
    return out


def load_survey(pest: str) -> list[dict]:
    p = config.DATA_DIR / "survey" / f"ncpms_{pest}_sigungu.csv"
    with p.open(encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    out = []
    for r in rows:
        name = r["sigungu"]
        if not name:
            continue
        try:
            v = float(r["value"])
        except ValueError:
            continue
        out.append({**r, "key": f"{norm_sido(r['sido'])} {name}", "value": v,
                    "date": datetime.strptime(r["survey_date"], "%Y-%m-%d").date()})
    return out


def half_month(d: date) -> str:
    return f"{d.month:02d}-{'a' if d.day <= 15 else 'b'}"


def auc(y: list[int], s: list[float]) -> float:
    pos = [x for x, t in zip(s, y) if t == 1]
    neg = [x for x, t in zip(s, y) if t == 0]
    if not pos or not neg:
        return float("nan")
    # Mann–Whitney (동점 0.5)
    order = sorted([(x, 1) for x in pos] + [(x, 0) for x in neg])
    rank_sum, i = 0.0, 0
    while i < len(order):
        j = i
        while j < len(order) and order[j][0] == order[i][0]:
            j += 1
        r = (i + 1 + j) / 2
        rank_sum += r * sum(1 for k in range(i, j) if order[k][1] == 1)
        i = j
    return (rank_sum - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(neg))


def brier(y: list[int], p: list[float]) -> float:
    return mean((pi - yi) ** 2 for yi, pi in zip(y, p))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pest", required=True)
    ap.add_argument("--train", default="2015-2022")
    ap.add_argument("--test", default="2023-2025")
    ap.add_argument("--export", default="",
                    help="variant 폴더(예: models/pepper/anthracnose/variants/survey_logit) — model.yaml params와 eval.json을 이 결과로 갱신")
    ap.add_argument("--with-history", action="store_true",
                    help="직전 회차 예찰값(log1p)을 피처로 추가(운영하려면 예찰 실시간 연동 필요)")
    args = ap.parse_args(argv)
    feat_names = FEATURES + (["prev_survey_log"] if args.with_history else [])
    train_years, test_years = _years(args.train), _years(args.test)

    import numpy as np
    from sklearn.ensemble import HistGradientBoostingClassifier
    from sklearn.linear_model import LogisticRegression
    from sklearn.preprocessing import StandardScaler

    survey = load_survey(args.pest)
    wx = load_weather_by_sigungu(sorted(set(train_years + test_years)), extra_regions=sorted({r["key"] for r in survey}))
    default = next(m for m in discover(include_demo=False) if m.card.pest_id == args.pest and m.is_default)

    # 기본 모델은 시군·연도 시계열로 한 번씩 돌린다(연초~조사일)
    default_cache: dict[tuple[str, int], dict[date, float]] = {}

    def default_index(sgg: str, d: date):
        k = (sgg, d.year)
        if k not in default_cache:
            series = sorted((w for w in wx[sgg].values() if w.date.year == d.year), key=lambda w: w.date)
            default_cache[k] = {p.date: p.index for p in default.model.predict(series)} if series else {}
        return default_cache[k].get(d - timedelta(days=1))

    samples = []
    skipped = defaultdict(int)
    for r in survey:
        sgg, d = r["key"], r["date"]
        if sgg not in wx:
            skipped["관측소 없음"] += 1
            continue
        days = wx[sgg]
        window = [days[d - timedelta(days=k)] for k in range(WINDOW_DAYS, 0, -1) if (d - timedelta(days=k)) in days]
        if len(window) < 25 or window[-1].date < d - timedelta(days=3):
            skipped["기상 부족"] += 1
            continue
        f = compute_features(window)
        samples.append({
            "sigungu": sgg, "sido": r["sido"], "date": d, "year": d.year, "hm": half_month(d),
            "y": 1 if r["value"] > 0 else 0, "value": r["value"],
            "x": [f.get(k, float("nan")) for k in FEATURES], "feats": f,
            "default": default_index(sgg, d),
        })

    # 직전 회차 조사값(같은 시군·같은 해) — '예찰 이력만으로 맞히기' 참고치
    by_sy: dict[tuple, list[dict]] = defaultdict(list)
    for smp in samples:
        by_sy[(smp["sigungu"], smp["year"])].append(smp)
    for lst in by_sy.values():
        lst.sort(key=lambda z: z["date"])
        for i, smp in enumerate(lst):
            smp["prev"] = lst[i - 1]["value"] if i > 0 else 0.0
            smp["feats"]["prev_survey_log"] = math.log1p(smp["prev"])
            smp["x"] = [smp["feats"].get(k, float("nan")) for k in feat_names]

    tr = [s for s in samples if s["year"] in train_years]
    te = [s for s in samples if s["year"] in test_years]
    if len(tr) < 50 or len(te) < 20:
        print(f"표본 부족: 학습 {len(tr)}, 시험 {len(te)} (건너뜀 {dict(skipped)})")
        return 2

    Xtr = np.array([s["x"] for s in tr], dtype=float)
    col_mean = np.nanmean(Xtr, axis=0)
    def fill(X):
        X = np.array(X, dtype=float)
        idx = np.where(np.isnan(X))
        X[idx] = np.take(col_mean, idx[1])
        return X
    Xtr = fill(Xtr)
    ytr = np.array([s["y"] for s in tr])
    sc = StandardScaler().fit(Xtr)
    clf = LogisticRegression(max_iter=2000, C=1.0).fit(sc.transform(Xtr), ytr)
    params = {
        "window_days": WINDOW_DAYS,
        "bias": round(float(clf.intercept_[0]), 4),
        "features": [
            {"name": n, "center": round(float(m), 3), "scale": round(float(s), 3), "weight": round(float(w), 4)}
            for n, m, s, w in zip(feat_names, sc.mean_, sc.scale_, clf.coef_[0])
        ],
    }
    def stat_prob(feats: dict) -> float:
        """StatModel.score와 같은 계산(z ±3 절단, 결측 피처는 0 기여)."""
        z = params["bias"]
        for spec in params["features"]:
            x = feats.get(spec["name"], float("nan"))
            if x is None or (isinstance(x, float) and math.isnan(x)):
                continue
            zz = max(-3.0, min(3.0, (x - spec["center"]) / max(1e-6, spec["scale"])))
            z += spec["weight"] * zz
        return 1 / (1 + math.exp(-z))

    gbm = HistGradientBoostingClassifier(max_depth=3, learning_rate=0.05, max_iter=300, random_state=0).fit(Xtr, ytr)

    clim: dict[str, float] = {}
    for hm in {s["hm"] for s in tr}:
        v = [s["y"] for s in tr if s["hm"] == hm]
        clim[hm] = mean(v)
    base_rate = float(ytr.mean())

    def within_round_auc(rows: list[dict], score) -> float:
        """같은 조사일(같은 회차) 안에서 시군끼리 얼마나 잘 가르는지 — 계절 효과를 뺀 변별력."""
        groups: dict[date, list[dict]] = defaultdict(list)
        for r in rows:
            groups[r["date"]].append(r)
        tot, wsum = 0.0, 0
        for g in groups.values():
            yy = [r["y"] for r in g]
            if 0 < sum(yy) < len(yy):
                a = auc(yy, [score(r) for r in g])
                tot += a * len(g)
                wsum += len(g)
        return round(tot / wsum, 3) if wsum else float("nan")

    def evaluate(rows: list[dict]) -> dict:
        y = [s["y"] for s in rows]
        sp = [stat_prob(s["feats"]) for s in rows]
        cp = [clim.get(s["hm"], base_rate) for s in rows]
        gp = list(gbm.predict_proba(fill([s["x"] for s in rows]))[:, 1])
        dv = [(s["default"] if s["default"] is not None else 0.0) for s in rows]
        return {
            "n": len(rows), "positive_rate": round(mean(y), 3),
            "auc": {"survey_logit": round(auc(y, sp), 3), "climatology": round(auc(y, cp), 3),
                    "default_rule": round(auc(y, dv), 3), "gbm_reference": round(auc(y, gp), 3),
                    "persistence": round(auc(y, [r["prev"] for r in rows]), 3)},
            "within_round_auc": {"survey_logit": within_round_auc(rows, lambda r: stat_prob(r["feats"])),
                                 "default_rule": within_round_auc(rows, lambda r: r["default"] or 0.0),
                                 "persistence": within_round_auc(rows, lambda r: r["prev"]),
                                 "climatology": 0.5},
            "brier": {"survey_logit": round(brier(y, sp), 4), "climatology": round(brier(y, cp), 4),
                      "gbm_reference": round(brier(y, gp), 4), "constant_rate": round(brier(y, [base_rate] * len(y)), 4)},
        }

    result = {
        "pest_id": args.pest,
        "generated": date.today().isoformat(),
        "target": "시군구 예찰 조사값 > 0 (발생)",
        "train_years": args.train, "test_years": args.test,
        "n_sigungu": len({s["sigungu"] for s in samples}),
        "skipped": dict(skipped),
        "features": feat_names,
        "with_history": args.with_history,
        "train": evaluate(tr),
        "test": evaluate(te),
        "test_by_year": {y: evaluate([s for s in te if s["year"] == y]) for y in test_years if any(s["year"] == y for s in te)},
        "params": params,
        "season_profile": {hm: round(v, 3) for hm, v in sorted(clim.items())},
    }
    out = config.DATA_DIR / "survey" / f"eval_{args.pest}_survey{'_history' if args.with_history else ''}.json"
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    print(json.dumps({k: result[k] for k in ("n_sigungu", "skipped", "train", "test", "test_by_year")}, ensure_ascii=False, indent=1))
    print(f"\n저장: {out}")
    if args.export:
        export_variant(Path(args.export), result)
    return 0


def _pick(e: dict) -> dict:
    return {k: e[k] for k in ("n", "positive_rate", "auc", "within_round_auc", "brier")}


def export_variant(folder: Path, result: dict) -> None:
    """학습 결과를 variant의 model.yaml(params)과 eval.json(status: survey_evaluated)에 옮긴다.
    직전 예찰값 참고판(eval_<pest>_survey_history.json)이 있으면 eval.json에 참고로 붙인다."""
    import yaml

    if result.get("with_history"):
        raise SystemExit("--with-history 결과는 운영 모델로 내보내지 않습니다(예찰 실시간 연동 전).")
    my = folder / "model.yaml"
    card = yaml.safe_load(my.read_text(encoding="utf-8"))
    card["params"] = result["params"]
    my.write_text(yaml.safe_dump(card, allow_unicode=True, sort_keys=False), encoding="utf-8")
    ev = {
        "model_id": card["id"], "version": card.get("version", ""), "evaluated_at": result["generated"],
        "status": "survey_evaluated",
        "method": f"연도 분리 검증: 학습 {result['train_years']}, 시험 {result['test_years']}. 정답 = 시군구 예찰값 > 0.",
        "n_sigungu": result["n_sigungu"], "skipped": result["skipped"],
        "test": _pick(result["test"]),
        "test_by_year": {y: _pick(v) for y, v in result["test_by_year"].items()},
        "note": "AUC 1.0=완벽, 0.5=무작위. '같은 회차 변별력'은 같은 조사일의 시군끼리 비교한 AUC로, 계절(시기) 효과를 뺀 성능입니다.",
    }
    hist = config.DATA_DIR / "survey" / f"eval_{result['pest_id']}_survey_history.json"
    if hist.exists():
        h = json.loads(hist.read_text(encoding="utf-8"))
        ev["with_history_reference"] = {"note": "직전 회차 예찰값을 피처로 더한 판(운영엔 예찰 실시간 연동 필요)", "test": _pick(h["test"])}
    (folder / "eval.json").write_text(json.dumps(ev, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"내보냄: {my}, {folder / 'eval.json'}")


if __name__ == "__main__":
    raise SystemExit(main())
