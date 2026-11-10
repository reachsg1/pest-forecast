"""결측 처리.

1) 빠진 날짜를 채워 연속 시계열로 만든다.
2) 수치 결측은 앞뒤 최대 3일 선형보간(그 이상은 None 유지), is_interpolated 표시.
3) 지점 전체 결측률을 돌려줘 publish에서 '자료 부족' 표시에 쓴다.
"""
from __future__ import annotations

from dataclasses import replace
from datetime import date, timedelta
from typing import Optional

from models._base import DailyWeather

NUMERIC = ("tavg", "tmax", "tmin", "rh", "rain", "rain_hours", "lwd_hours", "sunshine", "radiation", "wind", "soil_moist")
MAX_GAP = 3


def _fill_series(vals: list[Optional[float]], max_gap: int = MAX_GAP, zero_fill: bool = False) -> tuple[list[Optional[float]], list[bool]]:
    n = len(vals)
    out = list(vals)
    flag = [False] * n
    i = 0
    while i < n:
        if out[i] is not None:
            i += 1
            continue
        j = i
        while j < n and out[j] is None:
            j += 1
        gap = j - i
        left = out[i - 1] if i > 0 else None
        right = out[j] if j < n else None
        if gap <= max_gap and (left is not None or right is not None):
            for k in range(i, j):
                if left is not None and right is not None:
                    w = (k - i + 1) / (gap + 1)
                    out[k] = left + (right - left) * w
                else:
                    out[k] = left if left is not None else right
                flag[k] = True
        elif zero_fill:
            for k in range(i, j):
                out[k] = 0.0
                flag[k] = True
        i = j
    return out, flag


def fill_gaps(series: list[DailyWeather], start: Optional[date] = None, end: Optional[date] = None) -> tuple[list[DailyWeather], float]:
    """(보간된 연속 시계열, 원 결측률) 반환."""
    if not series:
        return [], 1.0
    by_date = {w.date: w for w in series}
    start = start or min(by_date)
    end = end or max(by_date)
    days: list[date] = []
    d = start
    while d <= end:
        days.append(d)
        d += timedelta(days=1)
    rows = [by_date.get(dd, DailyWeather(date=dd)) for dd in days]
    missing_cells = 0
    total_cells = 0
    cols: dict[str, list[Optional[float]]] = {f: [getattr(r, f) for r in rows] for f in NUMERIC}
    flags = [False] * len(rows)
    for f, vals in cols.items():
        if f in ("tavg", "tmax", "tmin", "rh", "rain"):
            total_cells += len(vals)
            missing_cells += sum(1 for v in vals if v is None)
        filled, fl = _fill_series(vals, zero_fill=(f in ("rain", "rain_hours")))
        cols[f] = filled
        flags = [a or b for a, b in zip(flags, fl)]
    out: list[DailyWeather] = []
    for i, r in enumerate(rows):
        kw = {f: cols[f][i] for f in NUMERIC}
        out.append(replace(r, is_interpolated=r.is_interpolated or flags[i], **kw))
    missing_rate = missing_cells / total_cells if total_cells else 1.0
    return out, missing_rate
