"""예찰 자료가 충분히 모인 병해충에 예찰 학습 모델(로지스틱·RF·XGBoost·앙상블)을 자동으로 만든다.

    python scripts/auto_models.py [--dry-run]

매주 GitHub Actions(model-refresh.yml)가 실행. 병해충마다:
  1) 조건 확인: 예찰 CSV(data/survey)·정확한 조사 항목(pipeline/survey_trend.ITEMS)이 있고,
     학습 연도(2015~2022) 3년 이상·시험 연도(2023~2025) 2년 이상·표본 400건 이상
  2) 아직 학습 모델(variants/survey_*)이 없으면 뼈대 생성 → 로지스틱(+직전 예찰) 학습 → RF·XGBoost(+시군 지형)·앙상블 학습·검증
  3) 기본 모델 교체는 안전장치를 통과할 때만: 앙상블 시험 AUC ≥ 0.75 이고 기존 기본(규칙형)보다 0.10 이상 높을 때
결과 요약을 data/survey/auto_models_report.md 에 남긴다(무엇을 만들었고 무엇을 왜 건너뛰었는지).
새 작물·새 병해충(기본 모델 폴더가 없는 것)은 재배 기간·재배 면적 근거가 필요해 자동으로 만들지 않고 보고서에 '사람 확인 필요'로 남긴다.
"""
from __future__ import annotations

import argparse
import csv
import json
import subprocess
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pipeline import config  # noqa: E402
from pipeline.survey_trend import ITEMS  # noqa: E402

# pest_id → (NCPMS 작물 코드, 조사 구분, 예찰 구분, 화면 단위)
NCPMS = {
    "pepper_anthracnose": ("VC011205", "01320", "00209"),
    "pepper_phytophthora": ("VC011205", "01320", "00209"),
    "pepper_oriental_tobacco_budworm": ("VC011205", "01320", "00209"),
    "apple_anthracnose": ("FT010601", "01322", "00209"),
    "apple_oriental_fruit_moth": ("FT010601", "01322", "00209"),
    "rice_leaf_blast": ("FC010101", "01322", "00204"),
    "rice_planthoppers": ("FC010101", "01322", "00204"),
    "rice_sheath_blight": ("FC010101", "01322", "00204"),
}
TRAIN, TEST = range(2015, 2023), range(2023, 2026)
MIN_TRAIN_YEARS, MIN_TEST_YEARS, MIN_ROWS = 3, 2, 400
MIN_AUC, MIN_GAIN = 0.75, 0.10
PY = sys.executable


def run(args: list[str]) -> str:
    r = subprocess.run([PY, *args], cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        raise RuntimeError(f"{' '.join(args)}\n{r.stdout[-1500:]}\n{r.stderr[-1500:]}")
    return r.stdout


def survey_stats(pest: str) -> tuple[set[int], int]:
    p = config.DATA_DIR / "survey" / f"ncpms_{pest}_sigungu.csv"
    item = ITEMS[pest][0]
    years, n = set(), 0
    with p.open(encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r.get("item") == item and r.get("value") not in ("", None):
                years.add(int(r["year"]))
                n += 1
    return years, n


AUTO_ITEMS = config.DATA_DIR / "survey" / "items_auto.json"
# 백필 CSV를 뽑을 때 쓴 낱말(scripts/backfill_survey.EXTRACT)
KEYWORD = {"rice_leaf_blast": "잎도열병", "rice_planthoppers": "벼멸구", "rice_sheath_blight": "잎집무늬마름병"}


def item_candidates(pest: str, path: Path) -> list[str]:
    """CSV 안의 조사 항목 중 병해충 낱말로 시작하고 비율(율)로 잰 항목 — 하나면 자동 확정"""
    kw = KEYWORD.get(pest, "")
    seen: dict[str, int] = {}
    with path.open(encoding="utf-8") as f:
        for r in csv.DictReader(f):
            it = r.get("item", "")
            if it.startswith(kw) and "율" in it:
                seen[it] = seen.get(it, 0) + 1
    return sorted(seen, key=lambda k: -seen[k])


def base_folder(pest: str) -> Path | None:
    from models._base.registry import discover

    m = next((m for m in discover(include_demo=False) if m.card.pest_id == pest and m.is_base), None)
    return m.folder if m else None


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)
    lines = [f"# 예찰 학습 모델 자동 추가 보고 ({date.today().isoformat()})", ""]
    changed = False
    for pest, (kncr, examin, predictn) in NCPMS.items():
        folder = base_folder(pest)
        csv_path = config.DATA_DIR / "survey" / f"ncpms_{pest}_sigungu.csv"
        if folder is None:
            lines.append(f"- {pest}: 기본 모델 폴더 없음 → 사람 확인 필요")
            continue
        if (folder / "variants" / "survey_ens" / "model.yaml").exists():
            lines.append(f"- {pest}: 이미 학습 모델 있음(건너뜀)")
            continue
        if not csv_path.exists():
            lines.append(f"- {pest}: 예찰 CSV 아직 없음(백필 대기)")
            continue
        if pest not in ITEMS:
            cands = item_candidates(pest, csv_path)
            if len(cands) == 1:
                auto = json.loads(AUTO_ITEMS.read_text(encoding="utf-8")) if AUTO_ITEMS.exists() else {}
                unit = cands[0][cands[0].find("(") + 1: -1] if "(" in cands[0] else "조사값"
                auto[pest] = [cands[0], f"{unit}(%)" if "율" in unit else unit]
                if not args.dry_run:
                    AUTO_ITEMS.write_text(json.dumps(auto, ensure_ascii=False, indent=1), encoding="utf-8")
                ITEMS[pest] = tuple(auto[pest])
                lines.append(f"- {pest}: 조사 항목 자동 확정 '{cands[0]}'")
            else:
                lines.append(f"- {pest}: 조사 항목 후보가 {len(cands)}개 {cands[:6]} → 사람 확인 필요(pipeline/survey_trend.ITEMS)")
                continue
        years, n = survey_stats(pest)
        ntr, nte = len(years & set(TRAIN)), len(years & set(TEST))
        if ntr < MIN_TRAIN_YEARS or nte < MIN_TEST_YEARS or n < MIN_ROWS:
            lines.append(f"- {pest}: 자료 부족(학습 {ntr}년·시험 {nte}년·{n}건, 기준 {MIN_TRAIN_YEARS}/{MIN_TEST_YEARS}/{MIN_ROWS}) — 백필 대기")
            continue
        if args.dry_run:
            lines.append(f"- {pest}: 조건 충족(학습 {ntr}년·시험 {nte}년·{n}건) — dry-run이라 만들지 않음")
            continue
        item, unit = ITEMS[pest]
        unit_word = unit.replace("(%)", "")
        try:
            run(["scripts/scaffold_survey_variants.py", "--pest", pest, "--item", item, "--unit", unit_word,
                 "--kncr", kncr, "--examin", examin, "--predictn", predictn])
            rel = folder.relative_to(ROOT) / "variants" / "survey_hist"
            run(["-m", "pipeline.survey_train", "--pest", pest, "--with-history", "--export", str(rel)])
            run(["-m", "pipeline.survey_ml", "--pest", pest, "--export", "--static", "terrain"])
        except Exception as e:  # noqa: BLE001
            lines.append(f"- {pest}: 학습 실패 — {str(e).splitlines()[0][:200]}")
            continue
        res = json.loads((config.DATA_DIR / "survey" / f"eval_{pest}_models.json").read_text(encoding="utf-8"))
        ens = res["test"]["models"].get("survey_ens", {}).get("auc", 0)
        rule = res["test"]["baselines"].get("default_rule", {}).get("auc", 0.5)
        msg = f"- {pest}: 학습 모델 추가(시험 {res['test_years']}, 앙상블 AUC {ens}, 규칙형 {rule})"
        if ens >= MIN_AUC and ens - rule >= MIN_GAIN:
            my = folder / "model.yaml"
            txt = my.read_text(encoding="utf-8")
            if "default_variant" not in txt:
                my.write_text(txt.rstrip() + "\n# 자동 지정(scripts/auto_models.py): 예찰 검증 앙상블이 규칙형보다 우수\ndefault_variant: survey_ens\n", encoding="utf-8")
            msg += " → 기본 모델을 앙상블로 지정"
        else:
            msg += f" → 기본 모델은 그대로(기준: AUC ≥ {MIN_AUC}, 규칙형보다 +{MIN_GAIN})"
        lines.append(msg)
        changed = True
    out = config.DATA_DIR / "survey" / "auto_models_report.md"
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    print("CHANGED" if changed else "NO_CHANGE")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
