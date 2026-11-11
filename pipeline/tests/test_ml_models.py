"""학습한 기계학습 모델(유형 D)·앙상블(유형 E) 실행 규칙."""
from datetime import date, timedelta

from models._base.interface import DailyWeather
from models._base.registry import discover
from pipeline.run_models import run_all


def _wx(n=200):
    start = date(2025, 3, 1)
    return [DailyWeather(date=start + timedelta(days=i), tavg=24, tmax=29, tmin=19, rh=85,
                         rain=(12.0 if i % 3 == 0 else 0.0), lwd_hours=9) for i in range(n)]


def _models(ids):
    return [m for m in discover() if m.id in ids]


def test_rf_xgb_load_artifacts_and_use_survey_history():
    wx = _wx()
    hist = [{"date": date(2025, 7, 16), "value": 5.0, "sigungu": "경기 화성시", "distance_km": 3.0}]
    for m in _models({"pepper_anthracnose__survey_rf", "pepper_anthracnose__survey_xgb"}):
        none = {p.date: p for p in m.model.predict(wx, [])}
        hit = {p.date: p for p in m.model.predict(wx, hist)}
        d = date(2025, 8, 1)
        assert 0 <= hit[d].index <= 100 and hit[d].inputs["survey_ref"]["sigungu"] == "경기 화성시"
        assert hit[d].index >= none[d].index  # 직전 예찰에서 발생했으면 위험이 낮아지지 않는다
        assert none[date(2025, 3, 20)].index <= 24  # 시즌 밖(3월)


def test_ensemble_is_mean_of_members():
    ids = {"pepper_anthracnose__survey_hist", "pepper_anthracnose__survey_rf", "pepper_anthracnose__survey_xgb", "pepper_anthracnose__survey_ens"}
    models = _models(ids)
    spot = {"spot_code": "S1", "sigungu": "", "lat": 37.0, "lon": 127.0}
    rows = run_all([spot], {"S1": _wx()}, models, issued=date(2025, 8, 1), horizon=3)
    by = {}
    for r in rows:
        by.setdefault(r["target_date"], {})[r["model_id"]] = r
    day = by["2025-08-01"]
    members = [i for i in ids if not i.endswith("_ens")]
    expect = sum(day[m]["raw_index"] for m in members) / 3
    assert abs(day["pepper_anthracnose__survey_ens"]["raw_index"] - expect) < 0.11
    assert 0 <= day["pepper_anthracnose__survey_ens"]["inputs"]["agree_alert"] <= 3


def test_ensemble_skipped_when_member_missing():
    models = _models({"pepper_anthracnose__survey_rf", "pepper_anthracnose__survey_ens"})
    rows = run_all([{"spot_code": "S1", "sigungu": ""}], {"S1": _wx()}, models, issued=date(2025, 8, 1), horizon=1)
    assert not any(r["model_id"].endswith("_ens") for r in rows)


def test_ml_models_get_live_survey_history():
    from pipeline.survey_live import uses_survey

    ids = {m.id: uses_survey(m) for m in discover()}
    assert ids["pepper_anthracnose__survey_rf"] and ids["pepper_anthracnose__survey_xgb"] and ids["pepper_anthracnose__survey_hist"]
    assert not ids["pepper_anthracnose__survey_logit"] and not ids["pepper_anthracnose"]
