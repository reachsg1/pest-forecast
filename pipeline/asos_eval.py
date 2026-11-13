"""기상청 ASOS(종관) 일자료를 농업기상에 더하면 예찰 기반 발생 예측이 나아지는지 비교한다(분석용, 배치와 무관).

    python -m pipeline.asos_eval --pest <pest_id> [--train 2015-2022 --test 2023-2026] [--seeds 3]

- 표본: survey_train.build_samples(농업기상 + 직전 예찰). ASOS: scripts/fetch_asos.py 캐시, 지점 → 시군은 data/reference/asos_stations.csv
- 표본마다 예찰 시군에서 가장 가까운 ASOS 시군(같은 시군이면 0 km, 아니면 시군 대표점 거리)의 조사일 전날까지 자료로 피처를 만든다
- 비교(연도 분리, Random Forest 잎 최소 20 — 배포 모델과 같음, 난수 여러 개 평균)
  A 기존(농업기상)
  B +ASOS 새 항목(일조·일사·강수 지속시간·바람·이슬점·구름·최저습도·습한 날)
  C +ASOS 전체(새 항목 + ASOS로 다시 계산한 기온·습도·강수 피처)
  D 가까운 쪽(기온·습도·강수 피처를 농업기상과 ASOS 중 예찰 시군에 더 가까운 관측으로) + 새 항목
- 피처 묶음 두 가지: 기상+직전예찰(배포 모델과 같음), 기상만(직전 예찰 없이 날씨의 힘만)
결과: data/survey/eval_<pest>_asos.json
"""
from __future__ import annotations

import argparse
import csv
import json
import math
from collections import defaultdict
from datetime import date, timedelta
from statistics import mean

import numpy as np

from . import config, regions
from .survey_ml import FEATS_HIST, within_round_auc
from .survey_train import FEATURES, _years, auc, build_samples

NEW = ["a_sun_14d", "a_rad_14d", "a_rndur_14d", "a_wind_14d", "a_td_14d", "a_cloud_14d", "a_rhmin_14d", "a_humid_days_14d", "a_rndur_season"]
# 농업기상 피처 ↔ ASOS로 다시 계산한 같은 피처(잎 젖음은 ASOS에 없어 농업기상 유지)
DUP = {"tavg_14d": "a_tavg_14d", "rh_14d": "a_rh_14d", "rain_14d": "a_rain_14d", "rain_days_14d": "a_rain_days_14d",
       "tmin_7d": "a_tmin_7d", "rain_days_season": "a_rain_days_season", "wet_warm_days_season": "a_wet_warm_days_season"}
ALL = NEW + list(DUP.values())


def _f(v):
    try:
        return float(v) if v not in ("", None) else None
    except ValueError:
        return None


def load_asos(years: list[int]) -> tuple[dict[str, dict[date, dict]], dict[str, tuple[float, float]]]:
    """시군 키 → 날짜 → 그 시군 ASOS 지점 평균 값. 시군 위치는 시군 경계 파일의 대표점."""
    with (config.DATA_DIR / "reference" / "asos_stations.csv").open(encoding="utf-8") as f:
        st = {r["stn_id"]: r["sgg_key"] for r in csv.DictReader(f) if r["sgg_key"]}
    geo = json.loads((config.ROOT / "apps" / "web" / "public" / "geo" / "sigungu.json").read_text(encoding="utf-8"))
    loc = {g["properties"]["key"]: (g["properties"]["lat"], g["properties"]["lon"]) for g in geo["features"]}
    cols = {"tavg": "avgTa", "tmin": "minTa", "rain": "sumRn", "rndur": "sumRnDur", "rh": "avgRhm", "rhmin": "minRhm",
            "wind": "avgWs", "td": "avgTd", "sun": "sumSsHr", "rad": "sumGsr", "cloud": "avgTca"}
    acc: dict[str, dict[date, list[dict]]] = defaultdict(lambda: defaultdict(list))
    for stn, key in st.items():
        for y in years:
            p = config.CACHE_DIR / "asos" / "daily" / stn / f"{y}.json"
            if not p.exists():
                continue
            for r in json.loads(p.read_text(encoding="utf-8")):
                d = date.fromisoformat(r["tm"])
                acc[key][d].append({k: _f(r.get(c)) for k, c in cols.items()})
    out: dict[str, dict[date, dict]] = {}
    for key, days in acc.items():
        out[key] = {}
        for d, rows in days.items():
            v = {}
            for k in cols:
                xs = [r[k] for r in rows if r[k] is not None]
                v[k] = mean(xs) if xs else None
            if v["rain"] is None and v["tavg"] is not None:
                v["rain"] = 0.0  # ASOS 일강수 빈칸 = 비 없음
            out[key][d] = v
    return out, {k: loc[k] for k in out if k in loc}


def asos_features(days: dict[date, dict], d: date) -> dict[str, float] | None:
    win = [days[d - timedelta(days=j)] | {"date": d - timedelta(days=j)} for j in range(150, 0, -1) if (d - timedelta(days=j)) in days]
    last30 = [w for w in win if w["date"] >= d - timedelta(days=30)]
    if len(last30) < 25:
        return None
    l14 = [w for w in win if w["date"] >= d - timedelta(days=14)]
    l7 = [w for w in win if w["date"] >= d - timedelta(days=7)]
    season = [w for w in win if w["date"].year == d.year and (w["date"].month, w["date"].day) >= (6, 1)]

    def avg(seq, k):
        xs = [w[k] for w in seq if w[k] is not None]
        return mean(xs) if xs else float("nan")

    rain = lambda w: w["rain"] or 0.0  # noqa: E731
    return {
        "a_sun_14d": avg(l14, "sun"), "a_rad_14d": avg(l14, "rad"),
        "a_rndur_14d": float(sum(w["rndur"] or 0.0 for w in l14)), "a_wind_14d": avg(l14, "wind"),
        "a_td_14d": avg(l14, "td"), "a_cloud_14d": avg(l14, "cloud"), "a_rhmin_14d": avg(l14, "rhmin"),
        "a_humid_days_14d": float(sum(1 for w in l14 if (w["rh"] or 0) >= 85)),
        "a_rndur_season": float(sum(w["rndur"] or 0.0 for w in season)),
        "a_tavg_14d": avg(l14, "tavg"), "a_rh_14d": avg(l14, "rh"), "a_rain_14d": float(sum(rain(w) for w in l14)),
        "a_rain_days_14d": float(sum(1 for w in l14 if rain(w) >= 1.0)), "a_tmin_7d": avg(l7, "tmin"),
        "a_rain_days_season": float(sum(1 for w in season if rain(w) >= 1.0)),
        "a_wet_warm_days_season": float(sum(1 for w in season if rain(w) >= 1.0 and w["tavg"] is not None and 20 <= w["tavg"] <= 30)),
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pest", required=True)
    ap.add_argument("--train", default="2015-2022")
    ap.add_argument("--test", default="2023-2026")
    ap.add_argument("--seeds", type=int, default=3)
    a = ap.parse_args(argv)
    from sklearn.ensemble import RandomForestClassifier

    trY, teY = _years(a.train), _years(a.test)
    S, _ = build_samples(a.pest, trY, teY, FEATS_HIST)
    asos, aloc = load_asos(sorted(set(trY + teY)))

    # 표본마다 가장 가까운(자료 있는) ASOS 시군
    order_cache: dict[str, list[tuple[float, str]]] = {}
    keep = []
    for s in S:
        k = s["sigungu"]
        if k not in order_cache:
            me = aloc.get(k) or regions.location_of(k)
            order_cache[k] = sorted((0.0 if ak == k else (regions.haversine_km(me, al) if me else 9e9), ak) for ak, al in aloc.items())
        for km, ak in order_cache[k]:
            f = asos_features(asos[ak], s["date"])
            if f is not None:
                s["feats"].update(f)
                s["asos_km"], s["asos_key"] = km, ak
                keep.append(s)
                break
    S = keep
    tr = [s for s in S if s["year"] in trY]
    te = [s for s in S if s["year"] in teY]
    ytr = np.array([s["y"] for s in tr])
    yte = [s["y"] for s in te]

    def row(s, base, extra, nearest_swap=False):
        f = s["feats"]
        vals = []
        for n in base:
            if nearest_swap and n in DUP and s["asos_km"] < s["wx_km"]:
                vals.append(f.get(DUP[n], float("nan")))
            else:
                vals.append(f.get(n, float("nan")))
        return vals + [f.get(n, float("nan")) for n in extra]

    def impute(Atr, Ate):
        m = np.nanmean(Atr, 0)
        m = np.where(np.isnan(m), 0.0, m)
        for A in (Atr, Ate):
            i = np.where(np.isnan(A))
            A[i] = np.take(m, i[1])
        return Atr, Ate

    groups = {"A_기존": ([], False), "B_+새항목": (NEW, False), "C_+ASOS전체": (ALL, False), "D_가까운쪽+새항목": (NEW, True)}
    res = {
        "pest_id": a.pest, "generated": date.today().isoformat(), "train_years": a.train, "test_years": a.test, "seeds": a.seeds,
        "n_train": len(tr), "n_test": len(te), "n_sigungu": len({s["sigungu"] for s in S}),
        "distance_km": {
            "농업기상_중앙값": float(np.median([s["wx_km"] for s in S])), "ASOS_중앙값": float(np.median([s["asos_km"] for s in S])),
            "ASOS가_더_가까운_표본_비율": round(float(np.mean([s["asos_km"] < s["wx_km"] for s in S])), 3),
            "농업기상_자기시군_비율": round(float(np.mean([s["wx_km"] == 0 for s in S])), 3),
        },
        "year_split": {},
    }
    for set_name, base in (("기상+직전예찰", FEATS_HIST), ("기상만", FEATURES)):
        res["year_split"][set_name] = {}
        for g, (extra, swap) in groups.items():
            aucs, waucs = [], []
            for seed in range(a.seeds):
                Atr, Ate = impute(np.array([row(s, base, extra, swap) for s in tr], float), np.array([row(s, base, extra, swap) for s in te], float))
                m = RandomForestClassifier(n_estimators=500, random_state=seed, n_jobs=-1, min_samples_leaf=20, max_features="sqrt").fit(Atr, ytr)
                p = m.predict_proba(Ate)[:, 1].tolist()
                aucs.append(auc(yte, p))
                waucs.append(within_round_auc(te, p))
            res["year_split"][set_name][g] = {"auc": round(mean(aucs), 3), "within_round_auc": round(mean(w for w in waucs if not math.isnan(w)), 3)}
    out = config.DATA_DIR / "survey" / f"eval_{a.pest}_asos.json"
    out.write_text(json.dumps(res, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: res[k] for k in ("pest_id", "n_train", "n_test", "n_sigungu", "distance_km", "year_split")}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
