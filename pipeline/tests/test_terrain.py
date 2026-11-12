"""지형 정적 피처(pipeline/terrain.py)와 모델 연결."""
from datetime import date, timedelta

from models._base.interface import DailyWeather, ModelCard
from models._base.stat import StatModel
from pipeline import terrain
from pipeline.run_models import run_all


def test_spot_features_have_site_sgg_and_lapse():
    f = terrain.spot_features("467800A001")  # 이천시 중리동
    assert {"site_elev", "site_slope", "site_dist_sea_km", "sgg_elev_gentle", "sgg_gentle_share", "site_lapse_dt"} <= set(f)
    assert abs(f["site_lapse_dt"] - (-0.0065 * (f["sgg_elev_gentle"] - f["site_elev"]))) < 0.01
    assert terrain.spot_sgg_key("467800A001") == "경기 이천시"
    assert terrain.spot_features("NO_SUCH_SPOT") == {}
    assert terrain.sgg_features("없는 시군") == {}


def test_describe_for_panel():
    d = terrain.describe("026002D003")  # 태백 매봉산(해발 1,100m대)
    assert d and d["elev"] > 900 and d["lapse_dt"] > 0  # 재배지가 더 낮아 더 따뜻
    assert d["sgg_key"] == "강원 태백시"


def _card(features):
    return ModelCard(id="t", pest_id="t", name_ko="t", crop="pepper", kind="disease", type="C", version="0", horizon_days=7,
                     season={"start_month": 1, "end_month": 12}, inputs=[], params={"window_days": 14, "bias": 0.0, "features": features})


def _wx(n=20):
    d0 = date(2025, 7, 1)
    return [DailyWeather(date=d0 + timedelta(days=i), tavg=25, tmax=30, tmin=20, rh=80, rain=0.0) for i in range(n)]


def test_stat_model_uses_site_feature_only_when_listed():
    m = StatModel(_card([{"name": "sgg_gentle_share", "center": 0.0, "scale": 1.0, "weight": 2.0}]))
    hi = m.predict(_wx(), site={"sgg_gentle_share": 1.0})[-1]
    lo = m.predict(_wx(), site={"sgg_gentle_share": -1.0})[-1]
    none = m.predict(_wx())[-1]
    assert hi.index > none.index > lo.index
    assert hi.inputs.get("sgg_gentle_share") == 1.0


def test_run_all_passes_terrain_site_to_models():
    m = StatModel(_card([{"name": "site_elev", "center": 0.0, "scale": 100.0, "weight": 1.0}]))

    class LM:
        id = "t"
        card = m.card
        model = m

    spot = {"spot_code": "026002D003", "sigungu": "", "lat": 37.2, "lon": 128.9}
    rows = run_all([spot], {"026002D003": _wx()}, [LM()], issued=date(2025, 7, 20), horizon=0)
    assert rows and "site_elev" in rows[-1]["inputs"]
