# 예찰조사 정제 데이터 (survey.csv)

`pipeline/backtest.py`와 `pipeline/train_template.py`가 읽는 정답 데이터. 아래 컬럼으로 정제해 `survey.csv`로 저장한다.

| 컬럼 | 설명 |
|---|---|
| spot_code | 조사지점을 최근접 농업기상 관측지점 코드로 매칭한 값 |
| sigungu_code | 시군구 코드(선택) |
| crop_code | rice / apple / pepper … |
| pest_id | 모델 카드의 pest_id (예: apple_anthracnose) |
| survey_date | YYYY-MM-DD |
| round | 조사 회차(선택) |
| occurred | 발생 여부 0/1 |
| severity | 발생 정도(병반면적률·밀도 등, 선택) |
| source_file | 원본 파일명 |

원본: 공공데이터포털 "농촌진흥청_병해충 예찰조사"(2015~2025) 및 "병해충조사지점현황정보". 원본 CSV는 용량·개인정보 검토 후 `data/survey/raw/`(git 제외)에 두고 정제 스크립트로 변환한다.

## NCPMS 예찰 OpenAPI 수집본(시군구 단위)

`scripts/fetch_survey.py`로 받은 시군구별 조사값. 예찰 학습형 모델(`pipeline/survey_train.py`)의 정답이다.

| 파일 | 내용 |
|---|---|
| `ncpms_pepper_anthracnose_sigungu.csv` | 노지고추 '탄저병(피해과율)' 2015~2025, 5,006행(수치 4,675). 컬럼: year, round, survey_date, sido_code, sido, sigungu_code, sigungu, item, value |
| `eval_pepper_anthracnose_survey.json` | 기상만 쓴 로지스틱 — 학습 2015~2022 / 시험 2023~2025 결과와 계수 |
| `eval_pepper_anthracnose_survey_history.json` | 참고: 직전 회차 예찰값을 더한 판 |

- 회차: 6~9월 매월 1·16일(연 최대 8회). 2015년은 6월 16일부터 4회
- 관측소와는 설치 주소(`data/reference/agri_stations.csv`)의 '시도 시군'으로 짝짓는다. 관측소가 없는 시군은 학습에서 뺀다
- 재수집: `python scripts/fetch_survey.py --crop VC011205 --examin 01320 --item 탄저병 --pest pepper_anthracnose` (캐시가 있으면 호출 0건, 처음 받을 때 약 790건)
