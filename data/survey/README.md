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
