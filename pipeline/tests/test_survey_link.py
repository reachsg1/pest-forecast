"""가까운 시군 대체와 예찰 실시간 연동(지점 이력 → 모델 입력) 규칙."""
from datetime import date, timedelta

from models._base.interface import DailyWeather, ModelCard
from models._base.stat import StatModel, survey_asof
from pipeline import regions, survey_live


def test_resolve_prefers_own_sigungu_then_nearest():
    locs = {"경기 이천시": (37.27, 127.43), "충북 음성군": (36.94, 127.69), "제주 제주시": (33.50, 126.53)}
    own = regions.resolve("경기 이천시", locs.keys(), available_locs=locs)
    assert own.key == "경기 이천시" and own.distance_km == 0 and not own.substituted
    # 여주(관측소 없음, 이천 바로 옆) → 이천이 제주보다 가깝다
    sub = regions.resolve("경기 여주시", locs.keys(), target_loc=(37.30, 127.64), available_locs=locs)
    assert sub.key == "경기 이천시" and sub.substituted and 10 < sub.distance_km < 30


def test_key_of_normalizes_sido_and_old_names():
    assert regions.key_of("경기도", "여주군") == "경기 여주시"
    assert regions.key_of("충청북도", "청원군") == "충북 청주시"
    assert regions.key_from_address("충남 당진군 당진읍 구봉로 46") == "충남 당진시"


def test_survey_asof_uses_latest_round_before_day_same_year():
    h = [{"date": date(2025, 7, 1), "value": 0.4}, {"date": date(2025, 7, 16), "value": 1.2}, {"date": date(2024, 9, 16), "value": 9.0}]
    assert survey_asof(h, date(2025, 7, 16))["value"] == 0.4   # 당일 조사는 아직 모름
    assert survey_asof(h, date(2025, 7, 20))["value"] == 1.2
    assert survey_asof(h, date(2025, 6, 20)) is None            # 올해 첫 회차 전(작년 값은 안 씀)


def _wx(start: date, n: int):
    return [DailyWeather(date=start + timedelta(days=i), tavg=25, tmax=30, tmin=20, rh=85, rain=2.0, lwd_hours=8) for i in range(n)]


def _card(params):
    return ModelCard(id="t", pest_id="t", name_ko="t", name_sci="", crop="pepper", kind="disease", type="C",
                     version="0", horizon_days=7, season={"start_month": 6, "end_month": 9}, inputs=[], description="", logic="", params=params)


def test_stat_model_survey_feature_raises_risk_after_occurrence():
    params = {"window_days": 30, "bias": 0.0, "survey": {"kncr": "VC011205", "examin": "01320", "item": "탄저병"},
              "features": [{"name": "prev_survey_log", "center": 0.2, "scale": 0.5, "weight": 1.5}]}
    m = StatModel(_card(params))
    wx = _wx(date(2025, 6, 1), 60)
    none = m.predict(wx, [])
    hit = m.predict(wx, [{"date": date(2025, 7, 1), "value": 3.0, "sigungu": "경기 이천시", "distance_km": 0.0}])
    d = date(2025, 7, 10)
    a = next(p for p in none if p.date == d)
    b = next(p for p in hit if p.date == d)
    assert b.index > a.index
    assert b.inputs["survey_ref"]["sigungu"] == "경기 이천시"
    # 이력 자체가 없으면(연동 실패) 표시
    assert next(p for p in m.predict(wx, None) if p.date == d).inputs.get("survey_missing") is True


def test_spot_history_substitutes_nearest_surveyed_sigungu():
    surveyed = {"경기 이천시": [{"date": date(2025, 7, 1), "value": 0.4}]}
    spots = [{"spot_code": "S1", "sigungu": "경기도 여주시 상거동", "lat": 37.30, "lon": 127.64},
             {"spot_code": "S2", "sigungu": "경기도 이천시 중리동", "lat": 37.27, "lon": 127.43}]
    regions.centroids.cache_clear()
    hist, src = survey_live.spot_history(spots, surveyed)
    assert src["S2"]["distance_km"] == 0
    assert src["S1"]["sigungu"] == "경기 이천시" and src["S1"]["distance_km"] > 0
    assert hist["S1"][0]["value"] == 0.4


def test_key_handles_missing_sido_and_moved_county():
    regions.centroids.cache_clear()
    assert regions.key_from_address("나주시 봉황면 욱곡리 654-5") == "전남 나주시"
    assert regions.key_from_address("경상북도 군위군 효령면") == "대구 군위군"
