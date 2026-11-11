"""models/ 폴더를 훑어 모델 플러그인을 찾는다."""
from __future__ import annotations

import importlib.util
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional

from .interface import BaseModel, ModelCard

MODELS_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = MODELS_ROOT.parent


@dataclass
class LoadedModel:
    card: ModelCard
    model: BaseModel
    folder: Path
    is_default: bool = True   # 화면 기본 모델(요약·등급 집계 기준). 병해충 폴더 model.yaml의 default_variant로 바꿀 수 있다
    is_base: bool = True      # 병해충 폴더 바로 아래 model.yaml(기준 규칙 모델), variants/* = False

    @property
    def id(self) -> str:
        return self.card.id

    @property
    def label(self) -> str:
        return self.card.label or ("기본 모델" if self.is_default else self.card.id)

    def eval_summary(self) -> dict:
        import json

        p = self.folder / "eval.json"
        if p.exists():
            try:
                return json.loads(p.read_text(encoding="utf-8"))
            except Exception:  # noqa: BLE001
                return {"status": "invalid_json"}
        return {"status": "not_evaluated"}


def _load_module(py_path: Path):
    if str(REPO_ROOT) not in sys.path:
        sys.path.insert(0, str(REPO_ROOT))
    name = "model_" + "_".join(py_path.parent.relative_to(MODELS_ROOT).parts)
    spec = importlib.util.spec_from_file_location(name, py_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load {py_path}")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def _apply_default_variant(found: list[LoadedModel]) -> None:
    """병해충 폴더 model.yaml의 ``default_variant: <variants 폴더 이름>``이 있으면 그 추가 모델을 기본으로 삼는다.
    지정한 모델이 적재되지 않았으면(--only·demo 제외 등) 원래 모델이 기본으로 남는다."""
    for base in [m for m in found if m.is_base and m.card.default_variant]:
        want = base.card.default_variant
        target = next((m for m in found if not m.is_base and m.card.pest_id == base.card.pest_id
                       and (m.folder.name == want or m.id == want)), None)
        if target is not None:
            base.is_default = False
            target.is_default = True


def discover(
    root: Optional[Path] = None,
    only: Optional[Iterable[str]] = None,
    include_draft: bool = True,
    include_demo: bool = False,
) -> list[LoadedModel]:
    """``model.yaml``이 있는 모든 폴더를 모델로 적재한다.

    - ``<작물>/<병해충>/model.yaml``            : 그 병해충의 기본 모델
    - ``<작물>/<병해충>/variants/<이름>/model.yaml`` : 같은 병해충의 추가 모델(지도에서 골라 볼 수 있음)
    같은 병해충의 모델은 ``pest_id``가 같고 ``id``는 서로 달라야 한다.

    only: 모델 id 또는 pest_id 목록으로 제한. include_draft=False면 draft 제외.
    include_demo=False면 demo_only 모델(데모 화면 확인용 가상 모형) 제외.
    """
    root = Path(root) if root else MODELS_ROOT
    wanted = set(only) if only else None
    found: list[LoadedModel] = []
    ymls = [(y, True) for y in sorted(root.glob("*/*/model.yaml"))] + [(y, False) for y in sorted(root.glob("*/*/variants/*/model.yaml"))]
    for yml, is_default in ymls:
        card = ModelCard.from_yaml(yml)
        if wanted and card.id not in wanted and card.pest_id not in wanted:
            continue
        if not include_draft and card.status == "draft":
            continue
        if card.demo_only and not include_demo:
            continue
        py = yml.parent / "model.py"
        if not py.exists():
            raise FileNotFoundError(f"{yml.parent}: model.py 없음")
        mod = _load_module(py)
        cls = getattr(mod, "Model", None)
        if cls is None:
            raise AttributeError(f"{py}: 'Model' 클래스를 정의해야 합니다")
        found.append(LoadedModel(card=card, model=cls(card), folder=yml.parent, is_default=is_default, is_base=is_default))
    _apply_default_variant(found)
    ids = [m.id for m in found]
    dup = {i for i in ids if ids.count(i) > 1}
    if dup:
        raise ValueError(f"모델 id 중복: {sorted(dup)} — 같은 병해충의 추가 모델은 id를 다르게 지정하세요")
    return found
