"""연례 자동 재학습 — 시즌이 끝나 새 해 예찰이 다 모이면 학습 창을 한 해 밀어 다시 학습하고, 나을 때만 교체한다.

    python -m pipeline.retrain [--dry-run] [--pest <id>] [--force]

매주 model-refresh.yml 이 실행하지만 실제 재학습은 1년에 한 번만 일어난다:
- 학습 창: 2015 ~ (마지막 끝난 시즌 - 2), 시험: (마지막 끝난 시즌 - 1) ~ 마지막 끝난 시즌 (`window`).
  11월부터 올해를 '끝난 시즌'으로 본다(pipeline/service.last_season). 예: 2026.11. → 학습 2015~2024·시험 2025~2026,
  2027.11. → 학습 2015~2025·시험 2026~2027.
- 조건: 배포 모델의 학습 창이 이보다 오래됐고, 시험 연도 예찰이 한 해도 빠짐없이 있을 때(`due`).
- 설정은 배포된 모델 파일에서 그대로 읽는다(`recipe`): RF 피처에 sgg_* 가 있으면 --static terrain, a_* 가 있으면 --asos,
  앙상블 params.calibration 이 있으면 --calibrate, survey_logit 폴더가 있으면 기상만 로지스틱도 다시 학습.
- 절차: 이전 모델을 새 시험 연도로 채점(survey_backtest) → 재학습·내보내기 → 새 모델 채점 → `decide_swap`:
  AUC 가 0.005 이상 떨어지거나 F1 이 0.01 이상 떨어지거나 서비스 기준(pipeline/service)을 못 넘으면 이전 모델로 되돌린다.
  보정 없이 재현율이 기준(0.40) 미만이면 --calibrate 로 한 번 더 학습해 F1 이 같거나 높으면 그쪽을 쓴다.
- 결과는 data/survey/auto_models_report.md 뒤에 붙이고, 바뀐 게 있으면 'CHANGED' 를 출력한다(워크플로가 테스트 후 커밋).
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from datetime import date
from pathlib import Path

import yaml

from . import config, service
from .survey_ml import THRESHOLD, _pest_folder, auc

ROOT = Path(__file__).resolve().parents[1]
FIRST_YEAR = service.FIRST_YEAR
AUC_TOL, F1_TOL = 0.005, 0.01
PY = sys.executable


def window(today: date) -> tuple[str, str]:
    """(학습 '2015-YYYY', 시험 'YYYY-YYYY') — 마지막 끝난 시즌 기준."""
    last = service.last_season(today)
    return f"{FIRST_YEAR}-{last - 2}", f"{last - 1}-{last}"


def deployed_window(pest: str) -> tuple[str, str] | None:
    p = config.DATA_DIR / "survey" / f"eval_{pest}_models.json"
    if not p.exists():
        return None
    d = json.loads(p.read_text(encoding="utf-8"))
    return str(d.get("train_years", "")), str(d.get("test_years", ""))


def due(pest: str, today: date) -> tuple[bool, str]:
    """재학습할 때인가 — 배포 창이 오래됐고 시험 연도 예찰이 다 있을 때."""
    train, test = window(today)
    cur = deployed_window(pest)
    if cur is None:
        return False, "학습 모델 평가 파일 없음"
    if cur[0] == train:
        return False, f"이미 최신 창(학습 {train})"
    miss = service.missing_years(pest, today)
    if miss:
        return False, f"예찰 미완비({miss})"
    return True, f"학습 {cur[0]} → {train}, 시험 {test}"


def recipe(vdir: Path) -> dict:
    """배포된 모델 파일에서 학습 설정을 읽는다."""
    def params(name):
        p = vdir / name / "model.yaml"
        return (yaml.safe_load(p.read_text(encoding="utf-8")) or {}).get("params") or {} if p.exists() else {}

    feats = params("survey_rf").get("features") or []
    return {
        "terrain": any(str(f).startswith("sgg_") for f in feats),
        "asos": any(str(f).startswith("a_") for f in feats),
        "calibrate": bool(params("survey_ens").get("calibration")),
        "logit": (vdir / "survey_logit" / "model.yaml").exists(),
    }


def ml_args(r: dict) -> list[str]:
    out: list[str] = []
    if r["terrain"]:
        out += ["--static", "terrain"]
    if r["asos"]:
        out.append("--asos")
    if r["calibrate"]:
        out.append("--calibrate")
    return out


def metrics(backtest: dict, years: list[int]) -> dict:
    """배포 기본 모델의 시험 연도 성적(backtest JSON 기준): AUC·정확도·재현율·정밀도·F1."""
    key = next((m["key"] for m in backtest["models"] if m.get("is_default")), backtest["models"][0]["key"])
    thr = backtest.get("threshold_index", round(THRESHOLD * 100))
    rows = [x for r in backtest["rounds"] if r["year"] in years for x in r["rows"]]
    y = [1 if x["actual"] > 0 else 0 for x in rows]
    p = [float(x["pred"].get(key, 0.0)) for x in rows]
    pred = [1 if int(v) >= thr else 0 for v in p]
    tp = sum(1 for a, b in zip(y, pred) if a and b)
    fp = sum(1 for a, b in zip(y, pred) if not a and b)
    fn = sum(1 for a, b in zip(y, pred) if a and not b)
    rec = tp / (tp + fn) if tp + fn else 0.0
    prec = tp / (tp + fp) if tp + fp else 0.0
    return {
        "n": len(rows),
        "auc": round(auc(y, p), 3) if rows and 0 < sum(y) < len(y) else 0.0,
        "accuracy": round(sum(1 for a, b in zip(y, pred) if a == b) / len(rows), 3) if rows else 0.0,
        "recall": round(rec, 3), "precision": round(prec, 3),
        "f1": round(2 * prec * rec / (prec + rec), 3) if prec + rec else 0.0,
    }


def decide_swap(old: dict, new: dict, listed: bool) -> tuple[bool, str]:
    """새 모델로 바꿀까 — 같은 시험 연도에서 AUC·F1 이 떨어지지 않고 서비스 기준을 넘을 때만."""
    if not listed:
        return False, "새 모델이 서비스 기준 미달"
    if new["auc"] < old["auc"] - AUC_TOL:
        return False, f"AUC 하락 {old['auc']}→{new['auc']}"
    if new["f1"] < old["f1"] - F1_TOL:
        return False, f"F1 하락 {old['f1']}→{new['f1']}"
    return True, f"AUC {old['auc']}→{new['auc']}, F1 {old['f1']}→{new['f1']}, 미리 알림 {old['recall']}→{new['recall']}"


def run(args: list[str]) -> str:
    r = subprocess.run([PY, "-m", *args], cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        raise RuntimeError(f"{' '.join(args)}\n{r.stdout[-1500:]}\n{r.stderr[-1500:]}")
    return r.stdout


def _eval_files(pest: str) -> list[Path]:
    d = config.DATA_DIR / "survey"
    return [d / f"eval_{pest}_models.json", d / f"eval_{pest}_survey_history.json", d / f"eval_{pest}_survey.json"]


def _train(pest: str, folder: Path, r: dict, train: str, test: str, calibrate: bool) -> None:
    years = ["--train", train, "--test", test]
    rel = folder.relative_to(ROOT) / "variants"
    if r["logit"]:
        run(["pipeline.survey_train", "--pest", pest, *years, "--export", str(rel / "survey_logit")])
    run(["pipeline.survey_train", "--pest", pest, *years, "--with-history", "--export", str(rel / "survey_hist")])
    extra = ml_args({**r, "calibrate": calibrate})
    run(["pipeline.survey_ml", "--pest", pest, *years, "--export", *extra])


def _score(pest: str, train: str, test: str) -> dict:
    run(["pipeline.survey_backtest", "--pest", pest, "--train", train, "--test", test])
    bt = json.loads((config.DATA_DIR / "backtest" / f"{pest}.json").read_text(encoding="utf-8"))
    from .survey_train import _years

    return metrics(bt, _years(test))


def _listed(pest: str, folder: Path, today: date) -> bool:
    ev = json.loads((folder / "variants" / "survey_ens" / "eval.json").read_text(encoding="utf-8"))
    return bool(service.decide(ev, pest, today)["listed"])


def retrain_one(pest: str, today: date, dry_run: bool = False) -> tuple[bool, str]:
    """한 병해충 재학습. (바뀌었는가, 보고 한 줄)"""
    ok, why = due(pest, today)
    if not ok:
        return False, f"- {pest}: 건너뜀 — {why}"
    train, test = window(today)
    crop, name = _pest_folder(pest)
    folder = config.MODELS_DIR / crop / name
    vdir = folder / "variants"
    r = recipe(vdir)
    if dry_run:
        return False, f"- {pest}: 재학습 예정({why}, 설정 {r}) — dry-run"
    cur = deployed_window(pest) or (train, test)
    with tempfile.TemporaryDirectory() as tmp:
        bak = Path(tmp) / "variants"
        shutil.copytree(vdir, bak)
        bak_eval = [(p, p.read_bytes()) for p in _eval_files(pest) if p.exists()]
        try:
            old = _score(pest, cur[0], test)  # 이전 모델을 새 시험 연도로 채점
            _train(pest, folder, r, train, test, r["calibrate"])
            new = _score(pest, train, test)
            note = ""
            if not r["calibrate"] and new["recall"] < service.MIN_RECALL:
                _train(pest, folder, r, train, test, True)
                cal = _score(pest, train, test)
                if cal["f1"] >= new["f1"]:
                    new, note = cal, " · 보정 적용(재현율 미달)"
                else:
                    _train(pest, folder, r, train, test, False)
                    _score(pest, train, test)
            swap, reason = decide_swap(old, new, _listed(pest, folder, today))
        except Exception as e:  # noqa: BLE001
            swap, reason = False, f"학습 실패 — {str(e).splitlines()[0][:200]}"
        if swap:
            _fix_card_years(vdir, cur, (train, test))
            return True, f"- {pest}: 교체(학습 {train}·시험 {test}) — {reason}{note}"
        shutil.rmtree(vdir)
        shutil.copytree(bak, vdir)
        for p, b in bak_eval:
            p.write_bytes(b)
        _score(pest, cur[0], test)  # 되돌린 모델 기준으로 과거 비교 자료 복구
        return False, f"- {pest}: 이전 모델 유지 — {reason}"


def _fix_card_years(vdir: Path, old: tuple[str, str], new: tuple[str, str]) -> None:
    """model.yaml 설명 문구의 연도('2015~2024', '2025~2026')를 새 창으로."""
    pairs = [(o.replace("-", "~"), n.replace("-", "~")) for o, n in zip(old, new) if o and o != n]
    for my in vdir.glob("*/model.yaml"):
        txt = my.read_text(encoding="utf-8")
        for o, n in pairs:
            txt = txt.replace(o, n)
        my.write_text(txt, encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pest", help="한 병해충만(기본: 학습 모델 있는 전부)")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--today", help="기준일 YYYY-MM-DD(시험용)")
    args = ap.parse_args(argv)
    today = date.fromisoformat(args.today) if args.today else date.today()
    from models._base.registry import discover

    pests = [args.pest] if args.pest else sorted({m.card.pest_id for m in discover() if m.id.endswith("__survey_ens")})
    train, test = window(today)
    lines = [f"## 연례 재학습 점검 ({today.isoformat()}, 창: 학습 {train}·시험 {test})", ""]
    changed = False
    for pest in pests:
        c, line = retrain_one(pest, today, args.dry_run)
        changed = changed or c
        lines.append(line)
        print(line, flush=True)
    report = config.DATA_DIR / "survey" / "auto_models_report.md"
    if not args.dry_run:
        prev = report.read_text(encoding="utf-8") if report.exists() else ""
        report.write_text(prev.rstrip() + "\n\n" + "\n".join(lines) + "\n", encoding="utf-8")
    print("CHANGED" if changed else "NO_CHANGE")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
