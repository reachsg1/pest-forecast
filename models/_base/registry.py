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

    @property
    def id(self) -> str:
        return self.card.id

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


def discover(root: Optional[Path] = None, only: Optional[Iterable[str]] = None, include_draft: bool = True) -> list[LoadedModel]:
    """``model.yaml``이 있는 모든 폴더를 모델로 적재한다.

    only: 모델 id 목록으로 제한. include_draft=False면 status가 draft인 모델 제외.
    """
    root = Path(root) if root else MODELS_ROOT
    wanted = set(only) if only else None
    found: list[LoadedModel] = []
    for yml in sorted(root.glob("*/*/model.yaml")):
        card = ModelCard.from_yaml(yml)
        if wanted and card.id not in wanted:
            continue
        if not include_draft and card.status == "draft":
            continue
        py = yml.parent / "model.py"
        if not py.exists():
            raise FileNotFoundError(f"{yml.parent}: model.py 없음")
        mod = _load_module(py)
        cls = getattr(mod, "Model", None)
        if cls is None:
            raise AttributeError(f"{py}: 'Model' 클래스를 정의해야 합니다")
        found.append(LoadedModel(card=card, model=cls(card), folder=yml.parent))
    return found
