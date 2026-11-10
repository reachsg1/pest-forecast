"""1차 대상 8개 병해충 모델 폴더를 생성한다(이미 있으면 건너뜀).

파라미터는 일반 문헌 범위의 '초기값'이며, 담당 연구자 검토 후 model.yaml에서 수정한다.
실행: python scripts/scaffold_models.py
"""
from __future__ import annotations

import json
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
MODELS = ROOT / "models"

COMMON_REF = "담당 연구자 지정 예정 — 초기값은 일반 문헌 범위에서 설정, 검토 필요"

SPECS = [
    {
        "folder": "apple/anthracnose",
        "card": {
            "id": "apple_anthracnose",
            "pest_id": "apple_anthracnose",
            "name_ko": "사과 탄저병",
            "name_sci": "Colletotrichum spp.",
            "crop": "apple",
            "kind": "disease",
            "type": "A",
            "version": "0.1.0",
            "horizon_days": 7,
            "season": {"start_month": 6, "end_month": 9},
            "inputs": ["tavg", "rain", "lwd_hours(추정)", "rh"],
            "description": "강우로 비산된 분생포자가 따뜻하고 젖은 과실 표면에서 감염. 장마·늦여름 고온다습기에 위험.",
            "logic": "온도 적합도(사다리꼴) × 잎젖음 충족도(온도별 요구 젖음시간 대비)를 일별 점수로 하고, 감소율 0.7로 누적한 감염 부하를 0~100으로 환산.",
            "params": {
                "temp": {"min": 15, "opt_low": 22, "opt_high": 28, "max": 32},
                "wetness_hours": [
                    {"temp": 15, "hours": 12},
                    {"temp": 20, "hours": 8},
                    {"temp": 25, "hours": 5},
                    {"temp": 30, "hours": 6},
                ],
                "rain_trigger_mm": 2.0,
                "rain_min_wet_hours": 8.0,
                "decay": 0.7,
                "load_sat": 2.5,
            },
        },
        "base": "InfectionModel",
    },
    {
        "folder": "apple/oriental_fruit_moth",
        "card": {
            "id": "apple_oriental_fruit_moth",
            "pest_id": "apple_oriental_fruit_moth",
            "name_ko": "복숭아순나방",
            "name_sci": "Grapholita molesta",
            "crop": "apple",
            "kind": "insect",
            "type": "B",
            "version": "0.1.0",
            "horizon_days": 10,
            "season": {"start_month": 4, "end_month": 10},
            "inputs": ["tavg", "tmax", "tmin"],
            "description": "연 4~5세대 발생. 각 세대 부화 유충기가 신초·과실 피해 시기.",
            "logic": "1월 1일부터 발육영점 10℃ 기준 유효적산온도를 누적하고, 세대별 부화·유충 DD 구간에서 지수 상승. 활동 적합 온도로 보정.",
            "params": {
                "base_temp": 10.0,
                "upper_temp": 35.0,
                "biofix": "01-01",
                "ramp_dd": 60,
                "activity_temp": {"min": 12, "opt_low": 20, "opt_high": 30, "max": 36},
                "generations": [
                    {"name": "월동세대 성충·1세대 부화", "dd_from": 250, "dd_to": 450, "peak": 85},
                    {"name": "2세대 부화·유충", "dd_from": 850, "dd_to": 1050, "peak": 100},
                    {"name": "3세대 부화·유충", "dd_from": 1450, "dd_to": 1650, "peak": 100},
                    {"name": "4세대 부화·유충", "dd_from": 2050, "dd_to": 2250, "peak": 90},
                ],
            },
        },
        "base": "DegreeDayModel",
    },
    {
        "folder": "rice/leaf_blast",
        "card": {
            "id": "rice_leaf_blast",
            "pest_id": "rice_leaf_blast",
            "name_ko": "벼 잎도열병",
            "name_sci": "Magnaporthe oryzae",
            "crop": "rice",
            "kind": "disease",
            "type": "A",
            "version": "0.1.0",
            "horizon_days": 7,
            "season": {"start_month": 6, "end_month": 8},
            "inputs": ["tavg", "rain", "lwd_hours(추정)", "rh", "sunshine"],
            "description": "20~28℃의 서늘하고 비·이슬이 잦아 잎이 오래 젖는 날이 이어질 때 감염 급증. 일조 부족·질소 과다 시 심해짐.",
            "logic": "온도 적합도 × 잎젖음 충족도 누적(감염 부하). NCPMS '도열병 방제결정지원'과 비교 검증 예정.",
            "params": {
                "temp": {"min": 15, "opt_low": 20, "opt_high": 27, "max": 32},
                "wetness_hours": [
                    {"temp": 15, "hours": 14},
                    {"temp": 20, "hours": 10},
                    {"temp": 25, "hours": 8},
                    {"temp": 30, "hours": 10},
                ],
                "rain_trigger_mm": 1.0,
                "rain_min_wet_hours": 10.0,
                "decay": 0.75,
                "load_sat": 3.0,
            },
        },
        "base": "InfectionModel",
    },
    {
        "folder": "rice/sheath_blight",
        "card": {
            "id": "rice_sheath_blight",
            "pest_id": "rice_sheath_blight",
            "name_ko": "벼 잎집무늬마름병",
            "name_sci": "Rhizoctonia solani",
            "crop": "rice",
            "kind": "disease",
            "type": "C",
            "version": "0.1.0",
            "horizon_days": 10,
            "season": {"start_month": 7, "end_month": 9},
            "inputs": ["tavg_30d", "rh_30d", "rain_days_30d"],
            "description": "고온다습(평균 25℃ 이상, 습도 85% 이상)이 지속되고 밀식·질소 과다일 때 수평·수직으로 확산.",
            "logic": "최근 30일 평균기온·습도·강수일수의 가중합을 로지스틱으로 변환한 휴리스틱. 예찰조사 적재 후 학습 계수로 교체.",
            "params": {
                "window_days": 30,
                "bias": -0.8,
                "features": [
                    {"name": "tavg_30d", "center": 26, "scale": 3, "weight": 1.2},
                    {"name": "rh_30d", "center": 85, "scale": 5, "weight": 1.0},
                    {"name": "rain_days_30d", "center": 12, "scale": 4, "weight": 0.6},
                ],
            },
        },
        "base": "StatModel",
    },
    {
        "folder": "rice/planthoppers",
        "card": {
            "id": "rice_planthoppers",
            "pest_id": "rice_planthoppers",
            "name_ko": "벼멸구·흰등멸구",
            "name_sci": "Nilaparvata lugens, Sogatella furcifera",
            "crop": "rice",
            "kind": "insect",
            "type": "C",
            "version": "0.1.0",
            "horizon_days": 10,
            "season": {"start_month": 7, "end_month": 9},
            "inputs": ["tavg_30d", "tmin_7d", "rain_days_30d"],
            "description": "6~7월 중국 남부에서 비래 후 고온에서 세대 증식. 비래 정보(기류·유아등 채집)는 외부 입력으로 추가 예정.",
            "logic": "비래 후 증식 조건(고온·온난한 야간)을 최근 기상 통계로 근사한 휴리스틱. 비래량 관측치 연동 전까지 보조 지표로만 사용.",
            "params": {
                "window_days": 30,
                "bias": -1.2,
                "features": [
                    {"name": "tavg_30d", "center": 27, "scale": 2.5, "weight": 1.0},
                    {"name": "tmin_7d", "center": 22, "scale": 3, "weight": 0.8},
                    {"name": "rain_days_30d", "center": 10, "scale": 4, "weight": -0.3},
                ],
            },
        },
        "base": "StatModel",
    },
    {
        "folder": "pepper/anthracnose",
        "card": {
            "id": "pepper_anthracnose",
            "pest_id": "pepper_anthracnose",
            "name_ko": "고추 탄저병",
            "name_sci": "Colletotrichum acutatum / C. scovillei",
            "crop": "pepper",
            "kind": "disease",
            "type": "A",
            "version": "0.1.0",
            "horizon_days": 7,
            "season": {"start_month": 6, "end_month": 9},
            "inputs": ["tavg", "rain", "lwd_hours(추정)", "rh"],
            "description": "빗물로 전파되며 과실이 젖은 상태로 22~30℃가 유지될 때 감염. 장마 전후 예방 방제가 핵심.",
            "logic": "온도 적합도 × 잎젖음 충족도 누적(감염 부하). NCPMS 고추 탄저병 최초 감염위험시기 문자 서비스와 비교 검증 예정.",
            "params": {
                "temp": {"min": 15, "opt_low": 22, "opt_high": 30, "max": 33},
                "wetness_hours": [
                    {"temp": 15, "hours": 12},
                    {"temp": 20, "hours": 8},
                    {"temp": 25, "hours": 6},
                    {"temp": 30, "hours": 6},
                ],
                "rain_trigger_mm": 1.0,
                "rain_min_wet_hours": 8.0,
                "decay": 0.7,
                "load_sat": 2.5,
            },
        },
        "base": "InfectionModel",
    },
    {
        "folder": "pepper/phytophthora",
        "card": {
            "id": "pepper_phytophthora",
            "pest_id": "pepper_phytophthora",
            "name_ko": "고추 역병",
            "name_sci": "Phytophthora capsici",
            "crop": "pepper",
            "kind": "disease",
            "type": "A",
            "version": "0.1.0",
            "horizon_days": 7,
            "season": {"start_month": 6, "end_month": 8},
            "inputs": ["tavg", "rain", "lwd_hours(추정)", "soil_moist(선택)"],
            "description": "토양 전염성. 집중호우로 토양이 과습하고 25~30℃일 때 유주자가 퍼져 급격히 발병. 배수 불량지에서 심함.",
            "logic": "감염 조건 모델에 강우 가중과 토양수분 보정(상세 관측데이터 연동 시)을 추가. 10mm 이상 강우일을 강한 젖음 조건으로 간주.",
            "params": {
                "temp": {"min": 15, "opt_low": 25, "opt_high": 30, "max": 35},
                "wetness_hours": [
                    {"temp": 15, "hours": 14},
                    {"temp": 20, "hours": 10},
                    {"temp": 25, "hours": 6},
                    {"temp": 30, "hours": 6},
                ],
                "rain_trigger_mm": 5.0,
                "rain_min_wet_hours": 12.0,
                "decay": 0.65,
                "load_sat": 2.2,
                "soil_moist_boost": {"threshold": 30, "factor": 1.3},
            },
        },
        "base": "InfectionModel",
    },
    {
        "folder": "pepper/tobacco_cutworm",
        "card": {
            "id": "pepper_tobacco_cutworm",
            "pest_id": "pepper_tobacco_cutworm",
            "name_ko": "담배거세미나방",
            "name_sci": "Spodoptera litura",
            "crop": "pepper",
            "kind": "insect",
            "type": "B",
            "version": "0.1.0",
            "horizon_days": 10,
            "season": {"start_month": 6, "end_month": 10},
            "inputs": ["tavg", "tmax", "tmin"],
            "description": "연 3~4세대, 8~9월 밀도 최고. 유충이 잎·과실을 식해. 광식성이라 인접 작물 밀도도 영향.",
            "logic": "발육영점 10℃ 기준 유효적산온도 누적, 세대별 유충기 DD 구간에서 지수 상승. 페로몬 트랩 채집 연동 시 biofix를 실측으로 전환.",
            "params": {
                "base_temp": 10.0,
                "upper_temp": 35.0,
                "biofix": "01-01",
                "ramp_dd": 80,
                "activity_temp": {"min": 14, "opt_low": 22, "opt_high": 32, "max": 38},
                "generations": [
                    {"name": "1세대 유충", "dd_from": 400, "dd_to": 600, "peak": 70},
                    {"name": "2세대 유충", "dd_from": 1000, "dd_to": 1200, "peak": 90},
                    {"name": "3세대 유충", "dd_from": 1600, "dd_to": 1800, "peak": 100},
                    {"name": "4세대 유충", "dd_from": 2200, "dd_to": 2400, "peak": 90},
                ],
            },
        },
        "base": "DegreeDayModel",
    },
]

BASE_MODULE = {
    "InfectionModel": "models._base.infection",
    "DegreeDayModel": "models._base.degree_day",
    "StatModel": "models._base.stat",
}


def main() -> None:
    for spec in SPECS:
        folder = MODELS / spec["folder"]
        folder.mkdir(parents=True, exist_ok=True)
        card = dict(spec["card"])
        card.setdefault("references", [COMMON_REF])
        card.setdefault("owner", "")
        card.setdefault("status", "draft")
        card.setdefault("ncpms_key", "")
        card.setdefault("ncpms_kind", "sick" if card["kind"] == "disease" else "insect")
        yml = folder / "model.yaml"
        if not yml.exists():
            yml.write_text(yaml.safe_dump(card, allow_unicode=True, sort_keys=False), encoding="utf-8")
        py = folder / "model.py"
        if not py.exists():
            base = spec["base"]
            py.write_text(
                f'"""{card["name_ko"]} 모델 — {BASE_MODULE[base]}.{base} 규칙을 그대로 사용.\n\n'
                "파라미터는 model.yaml에서 조정한다. 병해충 고유 논리가 필요하면 아래 클래스에서\n"
                "daily_score()/predict() 등을 재정의한다.\n"
                '"""\n'
                f"from {BASE_MODULE[base]} import {base}\n\n\n"
                f"class Model({base}):\n"
                "    pass\n",
                encoding="utf-8",
            )
        ev = folder / "eval.json"
        if not ev.exists():
            ev.write_text(json.dumps({"status": "not_evaluated", "note": "pipeline/backtest.py 실행 후 갱신"}, ensure_ascii=False, indent=2), encoding="utf-8")
        print("ok", spec["folder"])


if __name__ == "__main__":
    main()
