"""DEM(국토지리정보원 한반도 90m 수치표고모델)에서 지형 피처를 계산해 관측지점·시군 단위로 저장한다.

    python scripts/build_terrain_features.py --dem "<경로>/한반도90m_GRS80.img"

출력(커밋):
  data/reference/terrain_spots.csv     관측지점별 지형값(지점 좌표의 90m 격자 값)
  data/reference/terrain_sigungu.csv   시군별 요약(시군 경계 apps/web/public/geo/sigungu.json 안의 격자 통계)

피처(모두 DEM에서 직접 계산 — 다른 자료 없음):
  elev           해발고도(m)
  slope          경사(도), 3×3 중앙차분
  northness      cos(사면향) — 1=북사면, -1=남사면(일사량이 적을수록 큼)
  eastness       sin(사면향)
  tpi_1k         지형위치지수: 고도 − 반경 약 0.5km 평균(음수=골짜기·분지, 양수=능선)
  tpi_4k         같은 값, 반경 약 2km(넓은 분지·평야 판단)
  relief_5k      반경 약 2.5km 안의 최고−최저 고도(기복)
  dist_sea_km    가장 가까운 바다까지 거리(km). 바다 = DEM 0 이하·자료 없음
시군 요약은 전체 면적 통계와 함께 '완경사지(경사 7도 미만) = 농경지가 있을 만한 곳'만의 통계를 따로 낸다
(시군 전체 평균 고도는 산지에 끌려 실제 재배지 조건과 다르기 때문).
필요 패키지: rasterio, scipy (배치 실행에는 필요 없음, 피처를 다시 만들 때만)
"""
from __future__ import annotations

import argparse
import csv
import json
import math
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUT_SPOTS = ROOT / "data" / "reference" / "terrain_spots.csv"
OUT_SGG = ROOT / "data" / "reference" / "terrain_sigungu.csv"
GEO = ROOT / "apps" / "web" / "public" / "geo" / "sigungu.json"
SPOTS = ROOT / "data" / "reference" / "spots.json"
CELL = 90.0
# 남한(울릉도·독도 포함) 범위, DEM 좌표계(TM 중부원점 GRS80) 기준
WINDOW = (-20000, 30000, 560000, 700000)
SOURCE = "국토지리정보원 한반도 수치표고모델 90m(GRS80 TM 중부원점)"
GENTLE = 7.0  # 완경사 기준(도)


def nan_mean_filter(a: np.ndarray, size: int) -> np.ndarray:
    from scipy.ndimage import uniform_filter

    valid = np.isfinite(a).astype(np.float32)
    s = uniform_filter(np.where(valid > 0, a, 0).astype(np.float32), size=size, mode="constant")
    c = uniform_filter(valid, size=size, mode="constant")
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(c > 0.05, s / c, np.nan).astype(np.float32)


def main(argv: list[str] | None = None) -> int:
    import rasterio
    from rasterio.features import rasterize
    from rasterio.warp import transform, transform_geom
    from rasterio.windows import from_bounds
    from scipy.ndimage import distance_transform_edt, maximum_filter, minimum_filter

    ap = argparse.ArgumentParser()
    ap.add_argument("--dem", required=True)
    args = ap.parse_args(argv)

    with rasterio.open(args.dem) as d:
        win = from_bounds(*WINDOW, d.transform)
        z = d.read(1, window=win).astype(np.float32)
        tr = d.window_transform(win)
        crs = d.crs
    sea = z <= 0  # 0 = 바다, -9999 = 자료 없음
    z[sea] = np.nan
    print("격자", z.shape, "육지 비율", round(float((~sea).mean()), 3))

    feats: dict[str, np.ndarray] = {"elev": z}
    gy, gx = np.gradient(np.where(sea, 0, z), CELL)  # 행(y)은 북→남
    slope = np.degrees(np.arctan(np.hypot(gx, gy))).astype(np.float32)
    # 사면향: 내려가는 방향. 북쪽이 위(행 감소)이므로 북향 성분 = +gy
    asp = np.arctan2(-gx, gy)  # 0=북, π/2=동
    feats["slope"] = np.where(sea, np.nan, slope)
    flat = slope < 1.0
    feats["northness"] = np.where(sea | flat, np.nan, np.cos(asp)).astype(np.float32)
    feats["eastness"] = np.where(sea | flat, np.nan, np.sin(asp)).astype(np.float32)
    del gx, gy, asp
    feats["tpi_1k"] = (z - nan_mean_filter(z, 11)).astype(np.float32)
    feats["tpi_4k"] = (z - nan_mean_filter(z, 45)).astype(np.float32)
    zf = np.where(sea, np.nan, z)
    hi = maximum_filter(np.where(sea, -1e4, z), size=55)
    lo = minimum_filter(np.where(sea, 1e4, z), size=55)
    feats["relief_5k"] = np.where(sea, np.nan, hi - lo).astype(np.float32)
    del hi, lo, zf
    feats["dist_sea_km"] = np.where(sea, np.nan, distance_transform_edt(~sea) * CELL / 1000.0).astype(np.float32)
    names = list(feats)

    # --- 관측지점 -------------------------------------------------------------
    spots = json.loads(SPOTS.read_text(encoding="utf-8"))
    pts = [s for s in spots if s.get("lat") is not None and s.get("lon") is not None]
    xs, ys = transform("EPSG:4326", crs, [s["lon"] for s in pts], [s["lat"] for s in pts])
    inv = ~tr
    rows = []
    for s, x, y in zip(pts, xs, ys):
        c, r = inv * (x, y)
        r, c = int(math.floor(r)), int(math.floor(c))
        rec = {"spot_code": s["spot_code"], "name": s.get("name", ""), "station_alt": s.get("altitude")}
        inside = 0 <= r < z.shape[0] and 0 <= c < z.shape[1]
        for n in names:
            v = feats[n][r, c] if inside else np.nan
            if not np.isfinite(v) and inside:  # 해안 지점이 바다 격자에 걸리면 3×3 이웃 평균
                blk = feats[n][max(0, r - 1): r + 2, max(0, c - 1): c + 2]
                v = np.nanmean(blk) if np.isfinite(blk).any() else np.nan
            rec[n] = None if not np.isfinite(v) else round(float(v), 3)
        rows.append(rec)
    with OUT_SPOTS.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["spot_code", "name", "station_alt", *names])
        w.writeheader()
        w.writerows(rows)
    print(f"저장: {OUT_SPOTS} ({len(rows)}개 지점)")

    # --- 시군 요약 --------------------------------------------------------------
    geo = json.loads(GEO.read_text(encoding="utf-8"))
    keys = [f["properties"]["key"] for f in geo["features"]]
    shapes = [(transform_geom("EPSG:4326", crs, f["geometry"]), i + 1) for i, f in enumerate(geo["features"])]
    lab = rasterize(shapes, out_shape=z.shape, transform=tr, fill=0, dtype="int32")
    land = (lab > 0) & ~sea
    gentle = land & (feats["slope"] < GENTLE)
    n = len(keys) + 1

    def zstat(arr, mask):
        m = mask & np.isfinite(arr)
        cnt = np.bincount(lab[m], minlength=n)
        sm = np.bincount(lab[m], weights=arr[m].astype(np.float64), minlength=n)
        with np.errstate(invalid="ignore", divide="ignore"):
            return sm / cnt, cnt

    out = []
    area_cnt = np.bincount(lab[land], minlength=n)
    gentle_cnt = np.bincount(lab[gentle], minlength=n)
    stats = {}
    for nm in names:
        stats[nm], _ = zstat(feats[nm], land)
        stats[nm + "_gentle"], _ = zstat(feats[nm], gentle)
    steep_cnt = np.bincount(lab[land & (feats["slope"] >= 15)], minlength=n)
    for i, k in enumerate(keys, start=1):
        a = int(area_cnt[i])
        rec = {"key": k, "land_km2": round(a * CELL * CELL / 1e6, 1), "gentle_share": round(gentle_cnt[i] / a, 3) if a else None,
               "steep_share": round(steep_cnt[i] / a, 3) if a else None}
        for nm in ("elev", "slope", "tpi_4k", "relief_5k", "dist_sea_km", "northness"):
            v = stats[nm][i]
            rec[nm + "_mean"] = None if not np.isfinite(v) else round(float(v), 3)
        for nm in ("elev", "tpi_1k", "tpi_4k", "dist_sea_km"):
            v = stats[nm + "_gentle"][i]
            rec[nm + "_gentle"] = None if not np.isfinite(v) else round(float(v), 3)
        out.append(rec)
    with OUT_SGG.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(out[0].keys()))
        w.writeheader()
        w.writerows(out)
    print(f"저장: {OUT_SGG} ({len(out)}개 시군) · 출처 {SOURCE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
