from datetime import date

from pipeline import retrain


def test_window_shifts_one_year_after_season_ends():
    assert retrain.window(date(2026, 11, 23)) == ("2015-2024", "2025-2026")
    assert retrain.window(date(2027, 6, 1)) == ("2015-2024", "2025-2026")  # 시즌 중엔 그대로
    assert retrain.window(date(2027, 11, 2)) == ("2015-2025", "2026-2027")


def test_recipe_reads_deployed_model_files(tmp_path):
    (tmp_path / "survey_rf").mkdir()
    (tmp_path / "survey_rf" / "model.yaml").write_text(
        "params:\n  features: [tavg_14d, sgg_elev_gentle, a_sunshine]\n", encoding="utf-8")
    (tmp_path / "survey_ens").mkdir()
    (tmp_path / "survey_ens" / "model.yaml").write_text(
        "params:\n  calibration: {threshold: 0.26}\n", encoding="utf-8")
    r = retrain.recipe(tmp_path)
    assert r == {"terrain": True, "asos": True, "calibrate": True, "logit": False}
    assert retrain.ml_args(r) == ["--static", "terrain", "--asos", "--calibrate"]


def _bt(preds):
    return {"models": [{"key": "ens", "is_default": True}], "threshold_index": 50,
            "rounds": [{"year": 2026, "rows": [{"actual": a, "pred": {"ens": p}} for a, p in preds]}]}


def test_metrics_from_backtest_rows():
    m = retrain.metrics(_bt([(1, 80), (1, 20), (0, 10), (0, 60)]), [2026])
    assert m["n"] == 4 and m["recall"] == 0.5 and m["precision"] == 0.5 and m["accuracy"] == 0.5
    assert m["f1"] == 0.5 and 0.5 <= m["auc"] <= 1.0


def test_decide_swap_only_when_not_worse_and_listed():
    old = {"auc": 0.90, "f1": 0.60, "recall": 0.5}
    assert retrain.decide_swap(old, {"auc": 0.91, "f1": 0.62, "recall": 0.6}, True)[0]
    assert retrain.decide_swap(old, {"auc": 0.898, "f1": 0.595, "recall": 0.5}, True)[0]  # 허용 오차 안
    assert not retrain.decide_swap(old, {"auc": 0.88, "f1": 0.65, "recall": 0.6}, True)[0]
    assert not retrain.decide_swap(old, {"auc": 0.92, "f1": 0.55, "recall": 0.4}, True)[0]
    assert not retrain.decide_swap(old, {"auc": 0.95, "f1": 0.70, "recall": 0.7}, False)[0]
