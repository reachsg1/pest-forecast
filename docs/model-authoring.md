# 모델 작성 가이드 (연구자용)

병해충 하나 = 폴더 하나. 폴더를 추가하고 PR을 올리면 테스트·백테스트·미리보기까지 자동으로 돌아갑니다.

```
models/<작물>/<병해충>/
├─ model.yaml   # 모델 카드: 화면 '예측 근거' 탭에 그대로 보입니다
├─ model.py     # Model 클래스 (보통 3줄)
└─ eval.json    # 백테스트 결과 (자동 생성·갱신)
```

## 1. 어떤 유형을 고를까

| 유형 | 쓰는 경우 | 부모 클래스 | 핵심 파라미터 |
|---|---|---|---|
| A 감염 조건 | 비·이슬로 젖은 시간과 온도가 감염을 좌우하는 곰팡이·세균병 | `models._base.infection.InfectionModel` | `temp`(min/opt/max), `wetness_hours`(온도별 요구 젖음시간), `decay`, `load_sat` |
| B 발육 단계 | 세대가 뚜렷하고 발육영점온도·적산온도가 알려진 해충 | `models._base.degree_day.DegreeDayModel` | `base_temp`, `generations`(DD 구간), `activity_temp` |
| C 통계·ML | 기작이 복합적이거나 비래·돌발성. 예찰 데이터로 학습 | `models._base.stat.StatModel` | `features`(center/scale/weight), `bias` |

## 2. model.yaml 작성

`models/apple/anthracnose/model.yaml`을 복사해 고칩니다. 꼭 채울 항목:

- `id`, `pest_id`: 영문 소문자+밑줄, 저장소 전체에서 유일
- `season`: **병해충이 활동하는** 월. 시즌 밖에서는 지수를 24(정상) 이하로 자릅니다
  - 작물이 **포장에 있는지**(재배 지역·재배 기간)는 모델이 아니라 파이프라인이 판정합니다(`pipeline/phenology.py`). 작물이 없으면 '정상'이 아니라 '해당 없음'으로 발행됩니다. 재배 기간은 `data/reference/crop_calendar.yaml`, 재배 지역은 `data/reference/cultivation.csv`에 근거와 함께 적습니다(`data/reference/README.md`)
- `params`: 유형별 파라미터. **초기값 출처를 `references`에 반드시 적습니다**
- `owner`: 담당 연구자 이름, `status`: `draft` → 검토 후 `reviewed` → 운영 `active`
- `ncpms_key`: NCPMS 도감 키(sickKey/insectKey)를 넣으면 방제 정보가 자동 연동됩니다
- `label`: 화면에 보일 짧은 모델 이름(예: "적산온도형"). 같은 병해충에 모델이 여럿일 때 지도 선택 버튼에 쓰입니다

### 같은 병해충에 모델을 더 붙이기 (지도에서 골라 보기)

한 병해충을 여러 방식(감염조건형·적산온도형·통계형 등)으로 예측할 수 있습니다.

```
models/apple/anthracnose/
├── model.yaml, model.py, eval.json          ← 기본 모델(홈 요약·등급 집계·상세 화면 기준)
└── variants/
    └── <이름>/model.yaml, model.py, eval.json  ← 추가 모델
```

- 추가 모델의 `pest_id`는 기본 모델과 **같게**, `id`는 **다르게**(예: `apple_anthracnose__wetness`) 지정합니다. id가 겹치면 등록 단계에서 오류가 납니다
- `label`을 꼭 채웁니다. 예측 지도 조건 패널에 "예측 모델" 버튼으로 나타나고, 고르면 지도·범례·지점 패널이 그 모델 결과로 바뀝니다(URL `?model=<id>`로 공유 가능)
- 발행 결과: 모든 모델은 `public/data/risk/models/<id>.json`, 지점 시계열은 `spot/<code>.json`의 `series_by_model`. 기본 모델만 `risk/<pest_id>.json`·요약에 쓰입니다
- 기본으로 보일 모델 바꾸기: 병해충 폴더 `model.yaml`에 `default_variant: <variants 폴더 이름>`(예: 고추 탄저병 `survey_ens`). 지정 모델이 이번 실행에서 결과를 못 내면 원래 모델로 자동 발행하고 경고를 남깁니다. 학습 스크립트의 비교 기준(규칙형)은 계속 병해충 폴더 모델(`is_base`)입니다
- `demo_only: true`는 데모 실행(`--demo`)에서만 적재되는 시연용 모형입니다. 실제 모델에는 쓰지 않습니다(`apple/anthracnose/variants/demo_wet` 참고)
- 추가 모델도 파라미터 근거를 `references`에 적고 `status: draft`로 시작합니다

### 예찰 자료로 학습한 모델(예찰 학습형)

NCPMS 시군구 예찰값을 정답으로, 같은 시군 농업기상 관측소 일자료를 입력으로 유형 C(로지스틱)를 학습합니다. 고추 탄저병 예: `models/pepper/anthracnose/variants/survey_logit`.

1. `python scripts/fetch_weather_all.py` — 전국 일자료 캐시
2. `python scripts/fetch_survey.py --crop … --examin … --item … --pest …` — 코드는 `data/reference/ncpms_survey_targets.csv`
3. `python -m pipeline.survey_train --pest <pest_id>` — 학습/시험 연도를 나눠 기본 모델·계절 평균과 비교하고 `params`를 냅니다
4. `params`를 variant의 `model.yaml`에, 결과 요약을 `eval.json`(`status: survey_evaluated`)에 옮기면 검증 탭에 비교표가 나옵니다

예찰값을 입력으로 쓰려면(직전 회차 예찰값이 가장 강한 단서였음) `--with-history`로 학습하고, variant의 `model.yaml`에 `params.survey: {kncr, examin, predictn, item}`을 먼저 적은 뒤 `--export`합니다. 배치가 매일 NCPMS 예찰을 받아 지점별로 넘깁니다(`pepper/anthracnose/variants/survey_hist` 참고).

판단 기준: 전체 AUC만 보지 말고 **같은 회차 변별력**(같은 조사일의 시군끼리 비교)을 함께 봅니다. 계절 평균(0.5)보다 높아야 기상이 실제로 기여한 것입니다.

### 여러 알고리즘 비교(로지스틱·Random Forest·XGBoost·앙상블)

`python -m pipeline.survey_ml --pest <pest_id> [--export]` — 같은 표본(기상 + 직전 예찰값)으로 세 알고리즘을 학습하고, 세 모델 평균(앙상블)까지 학습에 쓰지 않은 해로 비교합니다.
- 하이퍼파라미터는 학습 연도 안에서 한 해씩 빼고 검증해 고릅니다(시험 연도는 선택에 쓰지 않음)
- 평가: AUC, 같은 회차 변별력, 정확도·정밀도·재현율(위험지수 50 이상 = 발생), Brier
- `--export`: `variants/survey_rf`(유형 D, `model.joblib`), `survey_xgb`(유형 D, `model.ubj`), `survey_ens`(유형 E, `params.members`)의 학습 파일·params·eval.json을 갱신하고, 로지스틱 variant의 eval.json도 같은 형식으로 다시 씁니다. 순서: `survey_train --export`(로지스틱 계수) → `survey_ml --export`
- 유형 D는 `models/_base/ml.py`가 학습 파일을 읽어 실행합니다. 파일은 학습 때 라이브러리 버전으로만 읽히므로 `requirements.txt`의 scikit-learn·xgboost 버전을 함께 고정합니다
- 유형 E(앙상블)는 단독 계산이 없고, `pipeline/run_models.py`가 구성 모델의 같은 지점·같은 날 위험지수를 평균합니다

## 3. model.py

```python
from models._base.infection import InfectionModel

class Model(InfectionModel):
    pass
```

규칙을 바꾸고 싶으면 `daily_score()`(A), `window_activity()`(B), `score()`(C) 또는 `predict()`를 재정의합니다.
`predict(weather, history)`는 `DailyWeather` 목록(연초부터, 예보 포함)을 받아 `RiskPoint`(0~100 지수, 등급, 설명용 inputs) 목록을 돌려주면 됩니다.

## 4. 로컬에서 확인

```bash
python -m pytest pipeline/tests -q                 # 공통 규칙(범위·정렬·시즌) 검사
python -m pipeline.cli run --demo --date 2026-07-15 --models <id>
cd apps/web && npm run dev                          # /pests/<id> 에서 카드와 추이 확인
```

## 5. PR 올리기

- 제목: `model(<id>): <무엇을 바꿨나>` — 예: `model(apple_anthracnose): 25℃ 요구 젖음시간 5→6h`
- PR이 열리면 `backtest-on-pr.yml`이 테스트·데모 실행·백테스트(예찰 데이터가 있을 때)를 돌리고 `eval.json`을 산출물로 올립니다
- Vercel이 미리보기 URL을 PR에 답니다. 지도에서 분포가 타당한지 보고 승인합니다

## 6. 자주 묻는 것

- **잎젖음시간이 관측에 없는데?** `DailyWeather.estimated_lwd()`가 습도·강우로 추정합니다. 시간별 자료가 연결되면 실측으로 바뀝니다.
- **학습한 계수를 어떻게 넣나?** `python -m pipeline.train_template --pest <id>` 출력(center/scale/weight/bias)을 `params`에 옮깁니다. 비선형 모델은 `predict()`에서 pickle을 읽도록 재정의합니다.
- **비래·트랩 자료는?** `predict(weather, history)`의 `history`에 외부 관측(유아등·페로몬트랩)을 넘기는 자리를 마련해 두었습니다. 파이프라인 연동은 2단계.

## 지형 정적 피처(site_·sgg_)

`pipeline/terrain.py`가 국토지리정보원 90m DEM에서 만든 지형값을 모든 모델에 넘긴다. 유형 C(`StatModel`)·D(`MLModel`)는 `params.features`에 이름만 적으면 쓰고, 직접 만든 `model.py`는 `predict(weather, history=None, site=None)`처럼 `site` 키워드 인자를 받으면 배치가 넘겨 준다(안 받으면 넘기지 않음).

| 이름 | 뜻 |
|---|---|
| `site_elev` `site_slope` `site_northness` `site_eastness` | 관측지점 해발고도(m)·경사(도)·북향·동향 성분 |
| `site_tpi_1k` `site_tpi_4k` | 지형위치지수(음수=골짜기·분지 → 찬 공기·습기 고임) |
| `site_relief_5k` `site_dist_sea_km` | 주변 기복(m)·바다까지 거리(km) |
| `sgg_elev_gentle` `sgg_tpi_1k_gentle` `sgg_tpi_4k_gentle` `sgg_dist_sea_km_gentle` | 지점이 속한 시군의 완경사지(경사 7도 미만 = 재배 가능지) 평균 |
| `sgg_gentle_share` `sgg_steep_share` `sgg_relief_5k_mean` `sgg_northness_mean` `sgg_elev_mean` | 시군 완경사지·급경사지(15도 이상) 비율, 평균 기복·사면, 전체 평균 고도 |
| `site_lapse_dt` | 관측지점 → 시군 재배지 평균 고도로 옮길 때 기온 보정(℃, 감률 6.5℃/km) — 생육(적산온도 등) 보정용 |

예찰(시군 단위) 학습 표본(`survey_train.build_samples`)에는 `sgg_` 피처만 들어 있다. 효과 분석은 `docs/terrain-analysis.md`.
