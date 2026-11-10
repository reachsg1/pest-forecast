"""중기예보 해석과 예보 연장(강수 처리) 규칙."""
from datetime import date, datetime, timedelta

from models._base.interface import DailyWeather
from pipeline.fetch import kma


def test_latest_mid_tmfc():
    assert kma.latest_mid_tmfc(datetime(2026, 11, 10, 7, 0)) == "202611100600"
    assert kma.latest_mid_tmfc(datetime(2026, 11, 10, 19, 0)) == "202611101800"
    assert kma.latest_mid_tmfc(datetime(2026, 11, 10, 5, 0)) == "202611091800"


def test_parse_mid_reads_am_pm_and_single_fields():
    ta = {"taMin4": "5", "taMax4": "12", "taMin8": "3", "taMax8": "10"}
    land = {"rnSt4Am": "20", "rnSt4Pm": "70", "wf4Am": "구름많음", "wf4Pm": "흐리고 비", "rnSt8": "10", "wf8": "맑음"}
    days = kma.parse_mid(ta, land, "202611100600")
    d4 = next(d for d in days if d.date == date(2026, 11, 14))
    assert d4.tmin == 5 and d4.tmax == 12 and d4.rain_prob == 70 and d4.wet
    d8 = next(d for d in days if d.date == date(2026, 11, 18))
    assert not d8.wet and d8.rain_prob == 10


def test_nearest_mid_region_picks_city_and_land():
    r = kma.nearest_mid_region(37.27, 127.43)  # 이천 관측소 근처
    assert r["city"] == "이천" and r["land_reg_id"] == "11B00000"
    g = kma.nearest_mid_region(35.16, 126.85)  # 광주광역시(경기 광주시와 혼동하지 않음)
    assert g["city"] == "광주" and g["land_reg_id"] == "11F20000"


def _obs(n, rain_every=0):
    start = date(2026, 10, 1)
    return [DailyWeather(date=start + timedelta(days=i), tavg=12, tmax=18, tmin=6, rh=70,
                         rain=(8.0 if rain_every and i % rain_every == 0 else 0.0)) for i in range(n)]


def test_extend_uses_mid_and_no_daily_drizzle():
    obs = _obs(40, rain_every=5)  # 5일에 한 번 8mm
    last = obs[-1].date
    mid = [kma.MidDay(date=last + timedelta(days=2), tmin=1, tmax=9, rain_prob=80, wf="흐리고 비"),
           kma.MidDay(date=last + timedelta(days=3), tmin=2, tmax=11, rain_prob=10, wf="맑음")]
    s = kma.extend_forecast(obs, [], last + timedelta(days=6), mid=mid)
    fut = {w.date: w for w in s if w.is_forecast}
    assert fut[last + timedelta(days=2)].rain == 8.0 and fut[last + timedelta(days=2)].tmin == 1
    assert fut[last + timedelta(days=3)].rain == 0.0 and fut[last + timedelta(days=3)].tavg == 6.5
    # 중기예보가 없는 날: 최근 14일 비 온 날이 절반 미만 → 0 (예전처럼 평균을 매일 나눠 넣지 않음)
    assert fut[last + timedelta(days=1)].rain == 0.0
    assert fut[last + timedelta(days=6)].rain == 0.0
