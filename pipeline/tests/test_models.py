"""모델 플러그인 공통 검증: 등록·범위·등급·시즌 규칙."""
from datetime import date, timedelta

import pytest

from models._base import DailyWeather, grade_of
from models._base.registry import discover


def synth_weather(start: date, days: int, wet: bool) -> list[DailyWeather]:
    out = []
    for i in range(days):
        d = start + timedelta(days=i)
        if wet:
            out.append(DailyWeather(date=d, tavg=25.0, tmax=29.0, tmin=21.0, rh=92.0, rain=12.0, rain_hours=8.0, sunshine=1.0))
        else:
            out.append(DailyWeather(date=d, tavg=25.0, tmax=31.0, tmin=19.0, rh=55.0, rain=0.0, rain_hours=0.0, sunshine=10.0))
    return out


def test_grade_boundaries():
    assert grade_of(0) == "정상"
    assert grade_of(24.9) == "정상"
    assert grade_of(25) == "예보"
    assert grade_of(50) == "주의보"
    assert grade_of(75) == "경보"
    assert grade_of(130) == "경보"
    assert grade_of(-5) == "정상"


def test_discover_finds_eight_models():
    models = discover()
    ids = sorted(m.id for m in models)
    # 병해충 8종 = 기본 모델 8개 + 실제 추가 모델(variants, demo_only 제외)
    assert len({m.card.pest_id for m in models}) == 8
    assert sum(1 for m in models if m.is_default) == 8
    assert len(ids) == 21  # 고추 역병·담배나방 예찰 학습형 4개씩 추가(11-12)
    assert "apple_anthracnose" in ids
    assert "pepper_anthracnose__survey_logit" in ids and "pepper_anthracnose__survey_hist" in ids
    assert all(m.card.type in {"A", "B", "C", "D", "E"} for m in models)


@pytest.mark.parametrize("m", discover(include_demo=True), ids=lambda m: m.id)
def test_predict_index_in_range_and_sorted(m):
    wx = synth_weather(date(2026, 1, 1), 300, wet=True)
    if m.card.type == "E":
        # 앙상블은 단독 계산하지 않는다(구성 모델 결과 평균은 test_ml_models에서 검사)
        assert m.model.predict(wx) == [] and m.card.params.get("members")
        return
    pts = m.model.predict(wx)
    assert len(pts) == 300
    assert all(0.0 <= p.index <= 100.0 for p in pts)
    assert [p.date for p in pts] == sorted(p.date for p in pts)
    assert all(p.grade == grade_of(p.index) for p in pts)


def test_infection_model_wet_beats_dry():
    m = next(x for x in discover() if x.id == "apple_anthracnose")
    wet = m.model.predict(synth_weather(date(2026, 7, 1), 10, wet=True))
    dry = m.model.predict(synth_weather(date(2026, 7, 1), 10, wet=False))
    assert wet[-1].index > dry[-1].index
    assert wet[-1].grade in {"주의보", "경보"}
    assert dry[-1].grade == "정상"


def test_out_of_season_capped():
    m = next(x for x in discover() if x.id == "apple_anthracnose")
    pts = m.model.predict(synth_weather(date(2026, 1, 10), 15, wet=True))
    assert all(p.index <= 24.0 for p in pts)
    assert pts[-1].inputs.get("out_of_season") is True


def test_degree_day_accumulates_and_peaks_in_season():
    m = next(x for x in discover() if x.id == "apple_oriental_fruit_moth")
    wx = synth_weather(date(2026, 1, 1), 240, wet=False)  # tavg 25 → 15 DD/day
    pts = m.model.predict(wx)
    dd = [p.inputs["degree_days"] for p in pts]
    assert dd == sorted(dd)
    assert max(p.index for p in pts if p.date.month >= 4) >= 75


def test_stat_model_insufficient_history_capped():
    m = next(x for x in discover() if x.id == "rice_sheath_blight")
    pts = m.model.predict(synth_weather(date(2026, 8, 1), 5, wet=True))
    assert all(p.index <= 24.0 for p in pts)
