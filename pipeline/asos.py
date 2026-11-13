"""기상청 ASOS(종관) 일자료 — 수집·캐시·피처(학습과 매일 배치가 같은 계산을 쓴다).

- 지점: data/reference/asos_stations.csv (지점번호·지점명·시군 키, 98곳)
- 서비스: 공공데이터포털 기상청_지상(종관, ASOS) 일자료 조회서비스(AsosDalyInfoService), 키는 DATA_GO_KR_KEY
- 캐시: data/cache/asos/daily/<지점>/<연도>.json (지난 해는 영구, 올해는 매일 어제까지 다시 받음 — 지점당 1건)
- 출처 표시: 기상청(공공누리 1유형)

피처(NEW)는 농업기상에 없는 항목만 쓴다(검증: docs/asos-analysis.md 'B'). 예찰 시군(학습) 또는 지점의 시군(배치)에서
가장 가까운, 그날 자료가 있는 ASOS 시군의 '그날 전날까지' 값으로 계산한다. 예보 날짜(발행일 이후)는 발행일 값을 그대로 쓴다.
"""
from __future__ import annotations

import csv
import json
import logging
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import date, timedelta
from functools import lru_cache
from statistics import mean
from typing import Iterable, Optional

from . import config, regions

log = logging.getLogger(__name__)

URL = "http://apis.data.go.kr/1360000/AsosDalyInfoService/getWthrDataList"
CACHE = config.CACHE_DIR / "asos" / "daily"
STATIONS_CSV = config.REFERENCE_DIR / "asos_stations.csv"

NEW = ["a_sun_14d", "a_rad_14d", "a_rndur_14d", "a_wind_14d", "a_td_14d", "a_cloud_14d", "a_rhmin_14d", "a_humid_days_14d", "a_rndur_season"]
# 농업기상 피처 ↔ ASOS로 다시 계산한 같은 피처(분석용 비교 C·D, pipeline/asos_eval.py)
DUP = {"tavg_14d": "a_tavg_14d", "rh_14d": "a_rh_14d", "rain_14d": "a_rain_14d", "rain_days_14d": "a_rain_days_14d",
       "tmin_7d": "a_tmin_7d", "rain_days_season": "a_rain_days_season", "wet_warm_days_season": "a_wet_warm_days_season"}
ALL = NEW + list(DUP.values())
COLS = {"tavg": "avgTa", "tmin": "minTa", "rain": "sumRn", "rndur": "sumRnDur", "rh": "avgRhm", "rhmin": "minRhm",
        "wind": "avgWs", "td": "avgTd", "sun": "sumSsHr", "rad": "sumGsr", "cloud": "avgTca"}
WINDOW = 150


def uses_asos(names: Iterable[str]) -> bool:
    return any(str(n).startswith("a_") for n in names)


def stations() -> list[dict]:
    with STATIONS_CSV.open(encoding="utf-8") as f:
        return list(csv.DictReader(f))


# ---------------------------------------------------------------- 수집
def fetch_year(key: str, stn: str, year: int, until: Optional[date] = None) -> list[dict]:
    """한 지점·한 해(1.1.~min(12.31., until)) 일자료. 1건 호출(최대 400행)."""
    end = min(date(year, 12, 31), until or (date.today() - timedelta(days=1)))
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
        except Exception as e:  # noqa: BLE001 — 키가 담긴 URL은 오류 문구에 넣지 않는다
            if attempt == 2:
                raise RuntimeError(f"ASOS {stn} {year}: {type(e).__name__}") from None
            time.sleep(2)
    return []


def _last_day(p) -> Optional[date]:
    try:
        rows = json.loads(p.read_text(encoding="utf-8"))
        return max(date.fromisoformat(r["tm"]) for r in rows) if rows else None
    except Exception:  # noqa: BLE001
        return None


def refresh(key: str, issued: date, warnings: list[str], workers: int = 8) -> int:
    """배치용: 발행일 전날까지 캐시를 채운다. 올해 파일은 마지막 날이 전날보다 이르면 다시 받는다(지점당 1건).
    150일 창이 지난해에 걸치면 지난해 파일도(없을 때만) 받는다. 반환: 호출 수."""
    from concurrent.futures import ThreadPoolExecutor

    until = issued - timedelta(days=1)
    years = sorted({until.year, (until - timedelta(days=WINDOW)).year})
    todo = []
    for st in stations():
        for y in years:
            p = CACHE / st["stn_id"] / f"{y}.json"
            if y < until.year:
                if not p.exists():
                    todo.append((st["stn_id"], y, p))
            else:
                last = _last_day(p) if p.exists() else None
                if last is None or last < until:
                    todo.append((st["stn_id"], y, p))

    def job(t):
        stn, y, p = t
        rows = fetch_year(key, stn, y, until)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")

    errors = []
    with ThreadPoolExecutor(max_workers=workers) as ex:
        for t, fut in [(t, ex.submit(job, t)) for t in todo]:
            try:
                fut.result()
            except Exception as e:  # noqa: BLE001
                errors.append(str(e)[:120])
    if errors:
        warnings.append(f"ASOS 일자료 {len(errors)}/{len(todo)}건 실패(캐시·가까운 지점으로 대체): {errors[0]}")
    log.info("ASOS 일자료: %d건 호출, 실패 %d", len(todo), len(errors))
    return len(todo)


# ---------------------------------------------------------------- 읽기·피처
def _f(v):
    try:
        return float(v) if v not in ("", None) else None
    except ValueError:
        return None


@lru_cache(maxsize=1)
def _sgg_locs() -> dict[str, tuple[float, float]]:
    geo = json.loads((config.ROOT / "apps" / "web" / "public" / "geo" / "sigungu.json").read_text(encoding="utf-8"))
    return {g["properties"]["key"]: (g["properties"]["lat"], g["properties"]["lon"]) for g in geo["features"]}


def load(years: Iterable[int]) -> tuple[dict[str, dict[date, dict]], dict[str, tuple[float, float]]]:
    """시군 키 → 날짜 → 그 시군 ASOS 지점 평균 값, 그리고 시군 위치(시군 경계 파일의 대표점)."""
    st = {r["stn_id"]: r["sgg_key"] for r in stations() if r["sgg_key"]}
    acc: dict[str, dict[date, list[dict]]] = defaultdict(lambda: defaultdict(list))
    for stn, key in st.items():
        for y in years:
            p = CACHE / stn / f"{y}.json"
            if not p.exists():
                continue
            try:
                rows = json.loads(p.read_text(encoding="utf-8"))
            except Exception:  # noqa: BLE001
                continue
            # 강수 지속시간은 재는 지점만 비 온 날 값이 있다(2025년 98곳 중 27곳). 그 해에 한 번이라도 값이 있으면 '재는 지점'으로 보고
            # 빈칸 = 0(비 없음), 아니면 빈칸 = 자료 없음(None → 학습 평균으로 채움)
            has_rndur = any(r.get("sumRnDur") not in ("", None) for r in rows)
            for r in rows:
                v = {k: _f(r.get(c)) for k, c in COLS.items()}
                if v["rndur"] is None and has_rndur:
                    v["rndur"] = 0.0
                acc[key][date.fromisoformat(r["tm"])].append(v)
    out: dict[str, dict[date, dict]] = {}
    for key, days in acc.items():
        out[key] = {}
        for d, rows in days.items():
            v = {}
            for k in COLS:
                xs = [r[k] for r in rows if r[k] is not None]
                v[k] = mean(xs) if xs else None
            if v["rain"] is None and v["tavg"] is not None:
                v["rain"] = 0.0  # ASOS 일강수 빈칸 = 비 없음
            out[key][d] = v
    locs = _sgg_locs()
    return out, {k: locs[k] for k in out if k in locs}


def features(days: dict[date, dict], d: date) -> Optional[dict[str, float]]:
    """d 전날까지 자료로 계산. 최근 30일 중 25일 이상 있어야 한다."""
    win = [days[d - timedelta(days=j)] | {"date": d - timedelta(days=j)} for j in range(WINDOW, 0, -1) if (d - timedelta(days=j)) in days]
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

    def total(seq, k):  # 값이 하나도 없으면 NaN(지점이 재지 않는 항목)
        xs = [w[k] for w in seq if w[k] is not None]
        return float(sum(xs)) if xs else float("nan")

    return {
        "a_sun_14d": avg(l14, "sun"), "a_rad_14d": avg(l14, "rad"),
        "a_rndur_14d": total(l14, "rndur"), "a_wind_14d": avg(l14, "wind"),
        "a_td_14d": avg(l14, "td"), "a_cloud_14d": avg(l14, "cloud"), "a_rhmin_14d": avg(l14, "rhmin"),
        "a_humid_days_14d": float(sum(1 for w in l14 if w["rh"] is not None and w["rh"] >= 85)),
        "a_rndur_season": total(season, "rndur") if season else 0.0,
        "a_tavg_14d": avg(l14, "tavg"), "a_rh_14d": avg(l14, "rh"), "a_rain_14d": float(sum(rain(w) for w in l14)),
        "a_rain_days_14d": float(sum(1 for w in l14 if rain(w) >= 1.0)), "a_tmin_7d": avg(l7, "tmin"),
        "a_rain_days_season": float(sum(1 for w in season if rain(w) >= 1.0)),
        "a_wet_warm_days_season": float(sum(1 for w in season if rain(w) >= 1.0 and w["tavg"] is not None and 20 <= w["tavg"] <= 30)),
    }


class Nearest:
    """대상 시군(또는 좌표)에서 가까운 순으로 ASOS 시군을 훑어 그날 피처가 나오는 첫 곳을 쓴다."""

    def __init__(self, data: dict[str, dict[date, dict]], locs: dict[str, tuple[float, float]]):
        self.data, self.locs = data, locs
        self._order: dict[tuple, list[tuple[float, str]]] = {}
        self._feat: dict[tuple[str, date], Optional[dict]] = {}

    def order(self, key: str, loc: Optional[tuple[float, float]] = None) -> list[tuple[float, str]]:
        ck = (key, loc)
        if ck not in self._order:
            me = loc or self.locs.get(key) or _sgg_locs().get(key) or regions.location_of(key)
            self._order[ck] = sorted((0.0 if ak == key else (regions.haversine_km(me, al) if me else 9e9), ak) for ak, al in self.locs.items())
        return self._order[ck]

    def feats(self, ak: str, d: date) -> Optional[dict]:
        if (ak, d) not in self._feat:
            self._feat[(ak, d)] = features(self.data[ak], d)
        return self._feat[(ak, d)]

    def at(self, key: str, d: date, loc: Optional[tuple[float, float]] = None) -> Optional[tuple[dict, float, str]]:
        for km, ak in self.order(key, loc):
            f = self.feats(ak, d)
            if f is not None:
                return f, km, ak
        return None


def attach(samples: list[dict]) -> int:
    """학습 표본(survey_train.build_samples)에 ASOS 피처를 붙인다(asos_km·asos_key 포함). 반환: 붙은 표본 수."""
    if not samples:
        return 0
    near = Nearest(*load(sorted({s["year"] for s in samples})))
    n = 0
    for s in samples:
        hit = near.at(s["sigungu"], s["date"])
        if hit:
            f, km, ak = hit
            s["feats"].update(f)
            s["asos_km"], s["asos_key"] = km, ak
            n += 1
    return n


def for_spots(spots: list[dict], issued: date, start: date, end: date) -> tuple[dict[str, dict[date, dict]], dict]:
    """배치용: 지점 코드 → 날짜(start~end) → ASOS 피처. 발행일 이후(예보)는 발행일 값.
    지점 시군에 ASOS가 있으면 그 시군, 없으면 지점 좌표에서 가장 가까운 ASOS 시군."""
    near = Nearest(*load(sorted({start.year - (1 if start.month <= 6 else 0), issued.year})))
    out: dict[str, dict[date, dict]] = {}
    srcs: dict[str, float] = {}
    for sp in spots:
        key = regions.key_from_address(sp.get("sigungu", ""))
        loc = (float(sp["lat"]), float(sp["lon"])) if sp.get("lat") and sp.get("lon") else None
        series: dict[date, dict] = {}
        d = start
        while d <= end:
            hit = near.at(key, min(d, issued), loc)
            if hit:
                series[d] = {k: hit[0][k] for k in NEW}
                if d == issued:
                    srcs[sp["spot_code"]] = hit[1]
            d += timedelta(days=1)
        out[sp["spot_code"]] = series
    kms = sorted(srcs.values())
    info = {"n_spots": len(srcs), "median_km": round(kms[len(kms) // 2], 1) if kms else None, "source": "기상청 ASOS 일자료(공공누리 1유형)"}
    return out, info
