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
    assert status["ok"] and status["n_models"] == 2 and status["n_spots"] == 12
    risk = json.loads((tmp_path / "web" / "risk" / "apple_anthracnose.json").read_text(encoding="utf-8"))
    assert len(risk["spots"]) == 12 and len(risk["spots"][0]["index_by_offset"]) == 11
    spot = json.loads((tmp_path / "web" / "spot" / "DEMO_SUWON.json").read_text(encoding="utf-8"))
    assert "apple_anthracnose" in spot["series"] and spot["weather"]
    assert (tmp_path / "pred" / "2026-07-15.csv").exists()
