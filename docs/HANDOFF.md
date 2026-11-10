# 인수인계 — 2026-11-10 기준 작업 상태

Claude(프로젝트 대화)에서 설계와 초기 구축을 마치고 Claude Code로 넘기는 시점의 기록이다.
읽는 순서: 이 문서 → `CLAUDE.md` → `setup-guide.md` → 필요 시 `design-summary.md`, `model-authoring.md`.

## 1. 지금까지 한 일

| 날짜 | 작업 | 결과물 |
|---|---|---|
| 11-09 | 가용 자원 조사, 서비스 설계(아키텍처·화면 10개·기능 27개·데이터 모델·로드맵) | `docs/design-summary.md` (전체본은 Claude 설계 문서) |
| 11-09 | 저장소 골격, 모델 플러그인 체계(`models/_base`), 1차 대상 8종 모델 폴더 | `models/` |
| 11-09 | 배치 파이프라인(수집·정제·실행·발행·백테스트·학습 템플릿·데모 모드), 테스트 21개 | `pipeline/` |
| 11-09 | Next.js 웹(홈·예측 지도·병해충 상세·내 농장·데이터/API·소개) + `/api/v1` 7개 | `apps/web/` |
| 11-09 | GitHub Actions(일일 배치, PR 검증), Vercel 설정, 문서 | `.github/workflows/`, `apps/web/vercel.json`, `docs/` |
| 11-10 | CLAUDE.md, 이 인수인계 문서 | 루트, `docs/` |

## 2. 검증 상태 (중요)

| 영역 | 상태 | 비고 |
|---|---|---|
| Python 모델·파이프라인 | **검증됨** | `pytest` 21개 통과, `cli.py run --demo` 실행 성공, 데모 JSON 생성됨(`apps/web/public/data`, 기준일 2026-07-15). 11-10 로컬 PC(Windows 11, Python 3.14.7, `.venv`)에서 재확인: 21개 통과, 데모 재생성 결과가 기존 JSON과 동일(`generated_at`만 다름) |
| Next.js 웹 | **검증됨(로컬)** | 11-10 로컬 PC(Node 26.13.0, Next 15.5.29)에서 `npm install`·`typecheck`·`build` 수정 없이 통과. `npm run dev`로 `/`, `/map`(지도·마커·지점 클릭 패널), `/pests/apple_anthracnose`, `/farm` 데모 데이터 정상 표시, 콘솔 오류 없음. 수정 2건: 지도 날짜 표시가 KST에서 하루 앞당겨지던 문제(`MapView.tsx` addDays를 UTC 계산으로), 상세 제목 '사과 사과 탄저병' 중복(`pests/[id]/page.tsx`). Vercel 배포는 미확인 |
| 외부 API 연동 | **미확인** | 농업기상 API 응답 태그명은 후보 목록(`pipeline/config.py` FIELD_CANDIDATES). NCPMS 예찰·예측·발생정보 서비스 코드 미확인. 기상청 단기예보 파서는 공개 스펙 기준으로 작성했으나 실호출 안 함 |
| GitHub Actions | **미실행** | 워크플로 문법은 표준 액션만 사용. 저장소 push 후 수동 실행으로 확인 필요 |
| 모델 파라미터 | **초안** | 일반 문헌 범위의 초기값. 담당 연구자 검토 전(`status: draft`) |

## 3. 확정된 설계 결정 (바꾸려면 설계서 함께 수정)

- 예측 계산은 **GitHub Actions 배치**, Vercel은 조회·시각화만(서버리스 실행시간·무상태 제약 회피, Python 모델 재사용)
- 1단계는 **정적 JSON**(`apps/web/public/data`)을 커밋 → Vercel 자동 재배포. DB(Neon)·Blob은 2단계
- 위험도 등급 4단계: 정상 0~24 / 예보 25~49 / 주의보 50~74 / 경보 75~100 (NCPMS 발생정보 용어와 정렬)
- 모델 유형 3종(A 감염조건 규칙, B 유효적산온도, C 통계·ML)을 플러그인으로; 병해충마다 폴더 하나(`model.yaml`+`model.py`+`eval.json`)
- 1차 대상 8종: 사과 탄저병(A)·복숭아순나방(B), 벼 잎도열병(A)·잎집무늬마름병(C)·벼멸구류(C), 고추 탄저병(A)·역병(A+토양수분)·담배거세미나방(B)
- 3일 이후 전망은 중기예보 연동 전까지 최근 14일 평균(지속성)으로 채우고 `is_forecast=True` 표시
- 잎젖음시간은 관측이 없으면 습도·강우로 추정(`DailyWeather.estimated_lwd`)
- 지도 OSM 래스터 타일(개발용) → 운영 전 VWorld 교체
- 내 농장은 1단계에서 브라우저 localStorage만(서버 저장 없음)

## 4. 알려진 미완·TODO (코드 안 TODO와 동일)

- 로컬 PC 환경: Python은 `.venv`(`.\.venv\Scripts\python.exe`), Node.js·git 설치 완료. 6절 지시문 1)~4) 완료(11-10). 다음은 GitHub 원격 저장소 생성·push → Actions 수동 실행 → Vercel 연결
- 웹 의존성: `recharts@2.x`는 지원 종료(deprecated) 경고 → v3 이전 검토

- `pipeline/config.py`: FIELD_CANDIDATES 실제 태그로 확정, NCPMS_SERVICE_CODES 빈 값 3개
- `pipeline/fetch/kma.py`: 중기예보(getMidTa/getMidLandFcst, regId) 미구현
- `pipeline/fetch/ncpms.py`: 방제정보 응답 태그(`developmentCondition` 등)는 가이드 기준 추정 → 실응답으로 확인
- `models/*/*/model.yaml`: `ncpms_key` 비어 있음, `references` 일반 문구
- `data/survey/survey.csv` 없음 → 백테스트는 `no_survey_data`
- 웹: 시군 단위 코로플레스(설계 S02 '표시: 시군')·주소 검색(지오코딩)·방제 캘린더(S05)·예찰 탐색(S06)·관리자(S10) 미구현. 네비게이션의 '검증·소개'는 `/about`에 합쳐 둠
- `apps/web/next.config.ts`의 `outputFileTracingIncludes`가 Vercel에서 `public/data`를 서버 라우트에 포함시키는지 배포 후 `/api/v1/status`로 확인

## 5. 환경·키

- 환경변수: `NCPMS_API_KEY`, `DATA_GO_KR_KEY`(인코딩/디코딩 어느 쪽이든 됨), `KMA_API_KEY`(없으면 DATA_GO_KR_KEY 사용), `CRON_SECRET`
- 키 값은 사용자가 보관. 코드·커밋·로그·이 문서에 넣지 않는다
- 농업기상 API는 개발계정(일 1,000건) → `run --spots N`으로 제한, 운영계정 전환 신청은 사용자 몫(`setup-guide.md` C-1)

## 6. Claude Code 첫 세션에 줄 지시문 (복사해서 사용)

```
CLAUDE.md와 docs/HANDOFF.md를 읽어. 그 다음:
1) apps/web에서 npm install → npm run typecheck → npm run build 를 통과시켜. 타입 오류는 설계 의도를 유지하면서 고치고, 바꾼 이유를 한 줄씩 알려줘.
2) npm run dev 로 띄워서 /, /map, /pests/apple_anthracnose, /farm 이 데모 데이터로 정상 표시되는지 확인해.
3) python -m pytest pipeline/tests -q 가 여전히 통과하는지 확인해.
4) 끝나면 git init 후 첫 커밋을 만들고, 남은 TODO를 docs/HANDOFF.md 4절에 반영해.
```

이후 세션: 키를 환경변수로 넣고 `python -m pipeline.cli probe` → config 수정 → `spots` → `run --spots 20` → 결과를 웹에서 확인 → push → Vercel 연결(`setup-guide.md` E).

## 7. 문서 간 역할

| 문서 | 역할 |
|---|---|
| `CLAUDE.md` | Claude Code가 매 세션 읽는 규칙·구조·명령 |
| `docs/HANDOFF.md` | 이 문서. 상태·결정·TODO. 큰 작업이 끝날 때마다 갱신 |
| `docs/setup-guide.md` | 사람이 직접 해야 하는 계정·키·승인 절차 |
| `docs/design-summary.md` | 설계서 요약(자원·모델·아키텍처·화면·기능·로드맵) |
| `docs/model-authoring.md` | 연구자용 모델 작성 가이드 |
