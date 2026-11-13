"""파이프라인 단위 테스트: 보간, 격자 변환, 예보 파싱, 데모 실행."""
import json
from datetime import date, timedelta

from models._base import DailyWeather
from pipeline import config
from pipeline.fetch.http import pick, to_float, xml_items
from pipeline.fetch.kma import extend_forecast, latlon_to_grid, parse_pcp
from pipeline.transform.interpolate import fill_gaps


def test_latlon_to_grid_seoul():
    assert latlon_to_grid(37.5665, 126.9780) == (60, 127)


def test_parse_pcp_variants():
    assert parse_pcp("강수없음") == 0.0
    assert parse_pcp("1.0mm") == 1.0
    assert parse_pcp("30.0~50.0mm") == 40.0
    assert parse_pcp("1mm 미만") == 0.5
    assert parse_pcp("50.0mm 이상") == 50.0


def test_fill_gaps_interpolates_short_gaps_only():
    d0 = date(2026, 6, 1)
    s = [
        DailyWeather(date=d0, tavg=20.0, rain=0.0),
        DailyWeather(date=d0 + timedelta(days=3), tavg=26.0, rain=5.0),
        DailyWeather(date=d0 + timedelta(days=10), tavg=24.0, rain=0.0),
    ]
    out, rate = fill_gaps(s)
    assert len(out) == 11
    assert out[1].tavg == 22.0 and out[2].tavg == 24.0 and out[1].is_interpolated
    assert out[6].tavg is None            # 6일 공백은 보간하지 않음
    assert out[6].rain == 0.0             # 강수는 0으로 채움
    assert 0.0 < rate < 1.0


def test_extend_forecast_fills_until_horizon():
    d0 = date(2026, 7, 1)
    obs = [DailyWeather(date=d0 + timedelta(days=i), tavg=25.0, tmax=30.0, tmin=20.0, rh=80.0, rain=2.0) for i in range(14)]
    fc = [DailyWeather(date=d0 + timedelta(days=14), tavg=26.0, rain=0.0, is_forecast=True)]
    series = extend_forecast(obs, fc, d0 + timedelta(days=23))
    assert series[-1].date == d0 + timedelta(days=23)
    assert all(w.is_forecast for w in series[14:])
    assert series[-1].tavg == 25.0


def test_xml_items_and_pick():
    xml = "<response><header><resultCode>200</resultCode></header><body><items><item><stn_Code>A1</stn_Code><temp>21.5</temp></item></items></body></response>"
    items = xml_items(xml)
    assert items == [{"stn_Code": "A1", "temp": "21.5"}]
    assert pick(items[0], config.FIELD_CANDIDATES["spot_code"]) == "A1"
    assert to_float(pick(items[0], config.FIELD_CANDIDATES["tavg"])) == 21.5
    assert to_float("-") is None


def test_normalize_key_decodes_portal_key():
    assert config.normalize_key("abc%2Fdef%3D%3D") == "abc/def=="
    assert config.normalize_key("plainkey") == "plainkey"


def test_demo_run_end_to_end(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "WEB_DATA_DIR", tmp_path / "web")
    monkeypatch.setattr(config, "PREDICTIONS_DIR", tmp_path / "pred")
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path / "cache")
    from pipeline.cli import main

    assert main(["run", "--demo", "--date", "2026-07-15", "--models", "apple_anthracnose,rice_sheath_blight"]) == 0
    status = json.loads((tmp_path / "web" / "status.json").read_text(encoding="utf-8"))
    assert status["ok"] and status["n_pests"] == 2 and status["n_spots"] == 12
    risk = json.loads((tmp_path / "web" / "risk" / "apple_anthracnose.json").read_text(encoding="utf-8"))
    assert len(risk["spots"]) == 12 and len(risk["spots"][0]["index_by_offset"]) == 11
    spot = json.loads((tmp_path / "web" / "spot" / "DEMO_SUWON.json").read_text(encoding="utf-8"))
    assert "apple_anthracnose" in spot["series"] and spot["weather"]
    assert (tmp_path / "pred" / "2026-07-15.csv").exists()


def test_multiple_models_per_pest(tmp_path, monkeypatch):
    """같은 병해충의 여러 모델: 모델별 지도 파일, 기본 모델 기준 요약, 지점별 모델 시계열."""
    monkeypatch.setattr(config, "WEB_DATA_DIR", tmp_path / "web")
    monkeypatch.setattr(config, "PREDICTIONS_DIR", tmp_path / "pred")
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path / "cache")
    from pipeline.cli import main

    # --models 에 pest_id를 주면 그 병해충의 모든 모델(데모 비교 모형 포함)이 돈다
    assert main(["run", "--demo", "--date", "2026-07-15", "--models", "apple_anthracnose"]) == 0
    web = tmp_path / "web"
    pests = json.loads((web / "pests.json").read_text(encoding="utf-8"))
    assert len(pests) == 1 and pests[0]["default_model"] == "apple_anthracnose"
    assert [m["model_id"] for m in pests[0]["models"]] == ["apple_anthracnose", "apple_anthracnose__demo_wet"]
    for mid in ("apple_anthracnose", "apple_anthracnose__demo_wet"):
        doc = json.loads((web / "risk" / "models" / f"{mid}.json").read_text(encoding="utf-8"))
        assert doc["model_id"] == mid and len(doc["spots"]) == 12
    default = json.loads((web / "risk" / "apple_anthracnose.json").read_text(encoding="utf-8"))
    assert default["model_id"] == "apple_anthracnose"
    summary = json.loads((web / "summary.json").read_text(encoding="utf-8"))
    assert summary["n_models"] == 1 and summary["n_model_variants"] == 2 and len(summary["pests"]) == 1
    spot = json.loads((web / "spot" / "DEMO_SUWON.json").read_text(encoding="utf-8"))
    assert "apple_anthracnose" in spot["series"] and "apple_anthracnose__demo_wet" in spot["series_by_model"]


def test_demo_only_models_excluded_from_live_discovery():
    from models._base.registry import discover

    live = {m.id for m in discover()}
    demo = {m.id for m in discover(include_demo=True)}
    assert "apple_anthracnose__demo_wet" not in live and "apple_anthracnose__demo_wet" in demo


def test_default_variant_ensemble_is_published_as_default(tmp_path, monkeypatch):
    """병해충 폴더 model.yaml의 default_variant(고추 탄저병 → 앙상블)가 요약·risk/<pest>.json·지점 series의 기준이 된다."""
    monkeypatch.setattr(config, "WEB_DATA_DIR", tmp_path / "web")
    monkeypatch.setattr(config, "PREDICTIONS_DIR", tmp_path / "pred")
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path / "cache")
    from pipeline.cli import main

    assert main(["run", "--demo", "--date", "2026-07-15", "--models", "pepper_anthracnose"]) == 0
    web = tmp_path / "web"
    pests = json.loads((web / "pests.json").read_text(encoding="utf-8"))
    p = pests[0]
    assert p["default_model"] == "pepper_anthracnose__survey_ens"
    assert p["models"][0]["model_id"] == "pepper_anthracnose__survey_ens" and p["models"][0]["is_default"]
    assert p["models"][1]["model_id"] == "pepper_anthracnose"  # 원래 규칙 모델은 비교용으로 둘째
    assert sum(m["is_default"] for m in p["models"]) == 1
    risk = json.loads((web / "risk" / "pepper_anthracnose.json").read_text(encoding="utf-8"))
    assert risk["model_id"] == "pepper_anthracnose__survey_ens" and risk["is_default"]
    spot = json.loads((web / "spot" / "DEMO_SUWON.json").read_text(encoding="utf-8"))
    assert "pepper_anthracnose__survey_ens" not in spot["series_by_model"]
    assert "pepper_anthracnose" in spot["series_by_model"]
    assert (web / "backtest" / "pepper_anthracnose.json").exists()  # 되돌려 보기 자료 복사
    assert (web / "trend" / "pepper_anthracnose.json").exists()  # 연도별 발생 추이 복사


def test_default_variant_falls_back_when_not_loaded():
    """지정한 기본 모델이 적재되지 않으면(예: 앙상블 제외) 원래 모델이 기본으로 남는다."""
    from models._base.registry import _apply_default_variant, discover

    loaded = [m for m in discover() if m.card.pest_id == "pepper_anthracnose"]
    assert [m.id for m in loaded if m.is_default] == ["pepper_anthracnose__survey_ens"]
    without_ens = [m for m in loaded if m.card.type != "E"]
    for m in without_ens:
        m.is_default = m.is_base
    _apply_default_variant(without_ens)
    assert [m.id for m in without_ens if m.is_default] == ["pepper_anthracnose"]


def test_survey_item_name_normalized_for_2026_prefix():
    from pipeline.fetch.survey import normalize_item

    assert normalize_item("노지고추 - 탄저병(피해과율)") == "탄저병(피해과율)"
    assert normalize_item("탄저병(피해과율)") == "탄저병(피해과율)"
    assert normalize_item("복숭아순나방붙이(트랩마리수)") == "복숭아순나방붙이(트랩마리수)"


def test_asos_features_and_daily_extra_reach_ml_model():
    """ASOS 피처: 전날까지 자료로 계산(최근 30일 중 25일 미만이면 None), MLModel은 daily_extra 값을 쓰고 없으면 표시한다."""
    from pipeline import asos

    d0 = date(2026, 7, 31)
    days = {d0 - timedelta(days=j): {"tavg": 25.0, "tmin": 20.0, "rain": 2.0 if j % 2 else 0.0, "rndur": 3.0, "rh": 90.0, "rhmin": 60.0,
                                      "wind": 2.0, "td": 21.0, "sun": 5.0, "rad": 15.0, "cloud": 6.0} for j in range(0, 60)}
    f = asos.features(days, d0)
    assert f is not None and f["a_sun_14d"] == 5.0 and f["a_rndur_14d"] == 3.0 * 14 and f["a_humid_days_14d"] == 14
    sparse = {k: v for k, v in days.items() if (d0 - k).days > 10}
    assert asos.features(sparse, d0) is None
    assert asos.uses_asos(["tavg_14d", "a_sun_14d"]) and not asos.uses_asos(["tavg_14d"])

    from models._base.registry import discover

    m = next((m for m in discover() if asos.uses_asos(m.card.params.get("features", []) or [])), None)
    if m is None:
        return  # ASOS 피처를 쓰는 모델이 아직 없으면 연결 검사만 생략
    wx = [DailyWeather(date=date(2026, 3, 1) + timedelta(days=i), tavg=24.0, tmin=19.0, tmax=30.0, rh=80.0, rain=1.0, lwd_hours=6.0)
          for i in range(160)]
    last = wx[-1].date
    hi = {last: {k: 0.0 for k in asos.NEW} | {"a_rndur_season": 400.0, "a_humid_days_14d": 14.0}}
    pts = m.model.predict(wx, [], daily_extra=hi)
    assert "asos_missing" not in pts[-1].inputs and pts[-2].inputs.get("asos_missing") is True
