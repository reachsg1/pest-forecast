"""예찰 학습형 추가 모델(variants) 뼈대를 다른 병해충에 만든다 — 고추 탄저병 variants를 본으로 이름·시기·예찰 항목만 바꾼다.

    python scripts/scaffold_survey_variants.py --pest pepper_phytophthora --item 역병 --unit 피해주율

만든 뒤 학습·내보내기:
    python -m pipeline.survey_train --pest <pest> --with-history --export models/<작물>/<병해충>/variants/survey_hist
    python -m pipeline.survey_ml --pest <pest> --export [--static terrain]
params(계수·학습 파일)는 학습이 채운다. 본 파일의 params는 비워 두고 survey 사양만 남긴다.
"""
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from models._base.registry import discover  # noqa: E402

TEMPLATE = ROOT / "models" / "pepper" / "anthracnose" / "variants"
VARIANTS = ["survey_hist", "survey_rf", "survey_xgb", "survey_ens"]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pest", required=True)
    ap.add_argument("--item", required=True, help="NCPMS 조사 항목에 포함될 글자(예: 역병)")
    ap.add_argument("--unit", default="피해율", help="화면 설명용(예: 피해주율)")
    args = ap.parse_args(argv)

    base = next(m for m in discover() if m.card.pest_id == args.pest and m.is_base)
    tpl_base = next(m for m in discover() if m.card.pest_id == "pepper_anthracnose" and m.is_base)
    vdir = base.folder / "variants"
    for v in VARIANTS:
        dst = vdir / v
        if dst.exists():
            print("이미 있음:", dst)
            continue
        dst.mkdir(parents=True)
        shutil.copy(TEMPLATE / v / "model.py", dst / "model.py")
        card = yaml.safe_load((TEMPLATE / v / "model.yaml").read_text(encoding="utf-8"))
        old_name = tpl_base.card.name_ko
        card.update({
            "id": f"{args.pest}__{v}", "pest_id": args.pest, "name_ko": base.card.name_ko, "name_sci": base.card.name_sci,
            "crop": base.card.crop, "kind": base.card.kind, "season": dict(base.card.season), "status": "draft", "version": "0.1.0",
        })
        for k in ("description", "logic"):
            if isinstance(card.get(k), str):
                card[k] = card[k].replace(old_name, base.card.name_ko).replace("탄저병", args.item).replace("피해과율", args.unit)
        card["inputs"] = [i.replace("피해과율", args.unit) for i in card.get("inputs", [])]
        spec = (card.get("params") or {}).get("survey")
        if v == "survey_ens":
            card["params"] = {"members": [f"{args.pest}__survey_hist", f"{args.pest}__survey_rf", f"{args.pest}__survey_xgb"]}
        else:
            card["params"] = {"survey": {**spec, "item": args.item}} if spec else {}
        card["references"] = [r.replace("'탄저병(피해과율)'", f"'{args.item}({args.unit})'").replace("노지고추 '탄저병", f"노지고추 '{args.item}")
                              for r in card.get("references", [])]
        (dst / "model.yaml").write_text(yaml.safe_dump(card, allow_unicode=True, sort_keys=False), encoding="utf-8")
        print("만듦:", dst)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
