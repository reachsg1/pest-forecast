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
- `demo_only: true`는 데모 실행(`--demo`)에서만 적재되는 시연용 모형입니다. 실제 모델에는 쓰지 않습니다(`apple/anthracnose/variants/demo_wet` 참고)
- 추가 모델도 파라미터 근거를 `references`에 적고 `status: draft`로 시작합니다

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
