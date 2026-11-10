# 병해충 발생 예측 서비스 (pest-forecast)

농촌진흥청 농업기상 관측·기상청 예보를 입력으로 작물별 병해충 발생 위험도를 매일 계산하고, 지도·농장 단위로 공개하는 공공 웹 서비스입니다.
설계서: `docs/` 및 Claude 설계 문서 참고.

```
데이터 소스 → GitHub Actions 일일 배치(Python) → apps/web/public/data/*.json 커밋 → Vercel(Next.js) 자동 배포
```

## 구성

| 경로 | 내용 |
|---|---|
| `models/` | 병해충별 모델 플러그인. `models/<작물>/<병해충>/{model.yaml, model.py, eval.json}` |
| `models/_base/` | 공통 인터페이스와 3가지 모델 유형(A 감염조건, B 적산온도, C 통계·ML) |
| `pipeline/` | 수집(농업기상·기상청·NCPMS) → 정제 → 모델 실행 → 발행, 백테스트, 학습 템플릿 |
| `apps/web/` | Next.js 15 웹(홈, 예측 지도, 병해충 상세, 내 농장, 데이터·API, 소개) + `/api/v1` |
| `data/` | 참조 데이터, 예찰 정제본, 일별 예측 스냅샷, API 캐시(git 제외) |
| `.github/workflows/` | `daily.yml`(매일 05:00 KST 배치), `backtest-on-pr.yml`(PR 검증) |
| `docs/` | 설치 가이드(직접 해야 할 일), 모델 작성 가이드 |

## 빠른 시작 (로컬)

```bash
# 1) 파이프라인 — 외부 API 없이 데모 데이터 생성
pip install -r requirements.txt
python -m pipeline.cli run --demo --date 2026-07-15
python -m pytest pipeline/tests -q

# 2) 웹
cd apps/web
npm install
npm run dev        # http://localhost:3000
```

실제 데이터로 돌리려면 `.env.example`을 참고해 키를 환경변수로 넣고:

```bash
python -m pipeline.cli probe     # 농업기상 API 응답 태그 확인 → pipeline/config.py FIELD_CANDIDATES 조정
python -m pipeline.cli spots     # 관측지점 목록 저장
python -m pipeline.cli run --spots 20   # 트래픽 한도 안에서 20개 지점만 먼저
```

## 모델 추가

`models/<작물>/<병해충>/` 폴더에 `model.yaml`(모델 카드)과 `model.py`(`Model` 클래스)를 두면 자동 등록됩니다. 자세한 내용은 `docs/model-authoring.md`.

## 위험도 등급

| 등급 | 위험지수 | 권고 |
|---|---|---|
| 정상 | 0~24 | 예찰 유지 |
| 예보 | 25~49 | 포장 관찰 강화, 약제 준비 |
| 주의보 | 50~74 | 예방 방제 검토 |
| 경보 | 75~100 | 적기 방제 |

## 라이선스·출처

재개방 데이터는 공공누리 제1유형(출처표시). 농업기상(국립농업과학원 농업날씨365), NCPMS, 기상청 자료를 사용합니다. 지도 타일 © OpenStreetMap contributors (운영 시 VWorld 등으로 교체 권장).
