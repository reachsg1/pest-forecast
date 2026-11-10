"""생물계절 판정 테스트: 비재배지·재배 시기·판정 생략, 파이프라인 반영."""
import json
from datetime import date

from pipeline import config
from pipeline.phenology import NOT_GROWN, OFF_SEASON, OK, Phenology, Window, region_key


def _write(tmp_path, csv_text: str, yaml_text: str):
    c = tmp_path / "cultivation.csv"
    y = tmp_path / "crop_calendar.yaml"
    c.write_text(csv_text, encoding="utf-8")
    y.write_text(yaml_text, encoding="utf-8")
    return c, y


CSV = """year,sido,sigungu,crop,area_ha,source
2024,경상북도,청송군,사과,3000,테스트
2025,경상북도,청송군,사과,3100,테스트
2025,경기도,수원시,사과,0,테스트
2025,전라남도,나주시,논벼,9000,테스트
"""

YAML = """
zones:
  영남권: [대구, 경북, 경남]
crops:
  apple:
    windows:
      - {level: national, start: "04-01", end: "11-10", source: t}
      - {level: zone, region: 영남권, start: "03-25", end: "11-15", source: t}
      - {level: sigungu, region: 경북 청송군, start: "04-05", end: "11-20", source: t}
  rice:
    windows: []
"""


def test_region_key_normalizes_sido():
    assert region_key("경기 수원시") == ("경기", "수원시")
    assert region_key("경상북도 청송군 청송읍") == ("경북", "청송군")
    assert region_key("강원특별자치도 춘천시") == ("강원", "춘천시")


def test_not_grown_when_area_zero_or_missing(tmp_path):
    ph = Phenology.load(*_write(tmp_path, CSV, YAML))
    assert ph.assess("apple", "경북 청송군").cultivation == "grown"
    assert ph.assess("apple", "경북 청송군").area_ha == 3100   # 최신 연도
    assert ph.assess("apple", "경기 수원시").cultivation == "not_grown"   # 0 ha
    assert ph.assess("apple", "제주 제주시").cultivation == "not_grown"   # 표에 없는 시군
    assert ph.assess("apple", "제주 제주시").status_on(date(2026, 7, 1)) == NOT_GROWN


def test_unknown_when_crop_absent_from_table(tmp_path):
    ph = Phenology.load(*_write(tmp_path, CSV, YAML))
    sc = ph.assess("pepper", "경북 청송군")
    assert sc.cultivation == "unknown" and sc.window is None
    assert sc.status_on(date(2026, 1, 1)) == OK  # 근거 없으면 차단하지 않음


def test_most_specific_window_wins(tmp_path):
    ph = Phenology.load(*_write(tmp_path, CSV, YAML))
    assert ph.assess("apple", "경북 청송군").window.level == "sigungu"
    assert ph.assess("apple", "경남 거창군").window.level == "zone"
    assert ph.assess("apple", "경기 포천시").window.level == "national"
    sc = ph.assess("apple", "경북 청송군")
    assert sc.status_on(date(2026, 4, 1)) == OFF_SEASON
    assert sc.status_on(date(2026, 4, 5)) == OK
    assert sc.status_on(date(2026, 11, 20)) == OK


def test_year_crossing_window():
    w = Window(start="11-01", end="06-10", level="national", region="")
    assert w.contains(date(2026, 12, 15)) and w.contains(date(2026, 3, 1))
    assert not w.contains(date(2026, 8, 1))


def test_missing_files_mean_no_gating(tmp_path):
    ph = Phenology.load(tmp_path / "none.csv", tmp_path / "none.yaml")
    assert ph.assess("apple", "경기 수원시").status_on(date(2026, 1, 1)) == OK
    assert len(ph.coverage_warnings({"apple"})) == 2


def test_reference_cultivation_csv_loads():
    """저장소의 실제 cultivation.csv(농업경영체 등록정보)가 판정에 쓰일 수 있는지."""
    if not config.CULTIVATION_CSV.exists() or config.CULTIVATION_CSV.stat().st_size < 100:
        return  # 자료 없는 환경
    ph = Phenology.load(config.CULTIVATION_CSV, config.CROP_CALENDAR_YAML, min_area_ha=0.0)
    assert {"apple", "rice", "pepper"} <= ph.crops_with_cultivation()
    cs = ph.assess("apple", "경북 청송군")          # 사과 주산지
    assert cs.cultivation == "grown" and cs.area_ha > 1000
    assert ph.assess("rice", "강원특별자치도 철원군").cultivation == "grown"   # 시도 정식 명칭도 매칭
    assert ph.assess("apple", "경기도 수원시 장안구").area_ha > 0             # 구 단위 주소는 시로 합산
    # 기준 면적을 올리면 소규모 재배지는 비재배지가 된다
    ph10 = Phenology.load(config.CULTIVATION_CSV, config.CROP_CALENDAR_YAML, min_area_ha=10.0)
    assert ph10.assess("apple", "제주 제주시").cultivation == "not_grown"


def test_demo_run_marks_not_grown_as_na(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "WEB_DATA_DIR", tmp_path / "web")
    monkeypatch.setattr(config, "PREDICTIONS_DIR", tmp_path / "pred")
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path / "cache")
    from pipeline.cli import main

    assert main(["run", "--demo", "--date", "2026-07-15", "--models", "apple_anthracnose"]) == 0
    risk = json.loads((tmp_path / "web" / "risk" / "apple_anthracnose.json").read_text(encoding="utf-8"))
    jeju = next(s for s in risk["spots"] if s["spot_code"] == "DEMO_JEJU")
    assert jeju["index_today"] is None and jeju["grade_today"] is None and jeju["na_today"] == "not_grown"
    assert all(v is None for v in jeju["index_by_offset"]) and jeju["max_index_7d"] is None
    assert risk["spots"][-1]["index_today"] is None          # 해당 없음은 맨 뒤
    naju = next(s for s in risk["spots"] if s["spot_code"] == "DEMO_NAJU")
    assert naju["index_today"] is not None and naju["phenology"]["cultivation"] == "grown"  # 나주 사과 12.7 ha
    summary = json.loads((tmp_path / "web" / "summary.json").read_text(encoding="utf-8"))
    p = summary["pests"][0]
    assert p["na_count"] == 1 and sum(p["grade_counts"].values()) == 11   # 제주시만 제외(사과 0.66 ha ≤ 1 ha)
    assert all(s["index"] is not None for s in p["top_spots"])
    spot = json.loads((tmp_path / "web" / "spot" / "DEMO_JEJU.json").read_text(encoding="utf-8"))
    assert spot["phenology"]["apple"]["cultivation"] == "not_grown"
    assert spot["series"]["apple_anthracnose"][0]["na_reason"] == "not_grown"


def test_open_ended_window_only_gates_before_start():
    from datetime import date as _d

    from pipeline.phenology import Window

    w = Window(start="05-01", end=None, level="zone", region="수도권")
    assert not w.contains(_d(2026, 4, 30))
    assert w.contains(_d(2026, 5, 1)) and w.contains(_d(2026, 12, 31))
    assert w.label() == "05-01~(끝 미정)"


def test_real_calendar_has_sourced_windows_for_all_crops():
    from datetime import date as _d

    from pipeline.phenology import OFF_SEASON, OK, load_default

    ph = load_default()
    assert {"apple", "rice", "pepper"} <= ph.crops_with_calendar()
    assert all(w.source for ws in ph.windows.values() for w in ws)  # 근거 없는 날짜 금지
    # 4월 하순 고추: 중부(경기) 정식 전, 남부(경북) 정식 시작
    assert ph.assess("pepper", "경기 이천시").status_on(_d(2026, 4, 25)) == OFF_SEASON
    assert ph.assess("pepper", "경북 안동시").status_on(_d(2026, 4, 25)) == OK
