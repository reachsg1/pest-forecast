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
| 모델 선택 | **구현됨(11-10)** | 병해충당 여러 모델(variants) 등록, 예측 지도에서 모델을 골라 결과 비교(`?model=`), 지점 패널·상세 예측 근거 탭 연동. 테스트 3개 추가(총 32개). 실제 추가 모델은 아직 없음 — 데모용 가상 모형(사과 탄저병 `demo_wet`, `--demo` 전용)으로만 시연 |
| 웹 디자인 | **개편됨(11-10)** | 전 화면(홈·지도·지점 패널·병해충 목록/상세·내 농장·데이터·소개, 헤더·푸터)을 공통 디자인 기반(Pretendard, 카드·버튼·세그먼트·표 클래스, `components/ui.tsx`)으로 재구성. 2차: 짙은 그라데이션 히어로 + 유리 카드, 홈 히어로에 한반도 위성 영상, 지도 위성(기본)/일반 전환·지도 위 유리 패널·지점 툴팁. 데스크톱·모바일(375px) 확인, 가로 넘침 없음, typecheck·build 통과 |
| 생물계절 판정 | **재배지: 자료 연결됨 / 재배 시기: 자료 없음** | 11-10 구현. 테스트 8개(총 29개 통과), 데모에서 가상 재배현황으로 비재배지 표시 확인, 임시 재배 기간으로 '재배 시기 아님' 화면 확인(임시값은 되돌림). `cultivation.csv`는 2025년 농업경영체 등록정보로 채움, 기준 1 ha 이하 = 비재배지. 데모도 같은 실제 자료로 판정(데모 12개 지점 중 제주시 사과·벼만 비재배지). `crop_calendar.yaml`은 비어 있어 재배 시기 판정은 생략 중 |
| 외부 API 연동 | **미확인** | 농업기상 API 응답 태그명은 후보 목록(`pipeline/config.py` FIELD_CANDIDATES). NCPMS 예찰·예측·발생정보 서비스 코드 미확인. 기상청 단기예보 파서는 공개 스펙 기준으로 작성했으나 실호출 안 함 |
| GitHub Actions | **미실행** | 워크플로 문법은 표준 액션만 사용. 저장소 push 후 수동 실행으로 확인 필요 |
| 모델 파라미터 | **초안** | 일반 문헌 범위의 초기값. 담당 연구자 검토 전(`status: draft`) |

## 3. 확정된 설계 결정 (바꾸려면 설계서 함께 수정)

- 예측 계산은 **GitHub Actions 배치**, Vercel은 조회·시각화만(서버리스 실행시간·무상태 제약 회피, Python 모델 재사용)
- 1단계는 **정적 JSON**(`apps/web/public/data`)을 커밋 → Vercel 자동 재배포. DB(Neon)·Blob은 2단계
- 위험도 등급 4단계: 정상 0~24 / 예보 25~49 / 주의보 50~74 / 경보 75~100 (NCPMS 발생정보 용어와 정렬)
- 모델 유형 3종(A 감염조건 규칙, B 유효적산온도, C 통계·ML)을 플러그인으로; 병해충마다 폴더 하나(`model.yaml`+`model.py`+`eval.json`)
- 1차 대상 8종: 사과 탄저병(A)·복숭아순나방(B), 벼 잎도열병(A)·잎집무늬마름병(C)·벼멸구류(C), 고추 탄저병(A)·역병(A+토양수분)·담배나방(B, 11-10 담배거세미나방에서 교체)
- 3일 이후 전망은 중기예보 연동 전까지 최근 14일 평균(지속성)으로 채우고 `is_forecast=True` 표시
- 잎젖음시간은 관측이 없으면 습도·강우로 추정(`DailyWeather.estimated_lwd`)
- 지도 OSM 래스터 타일(개발용) → 운영 전 VWorld 교체
- 내 농장은 1단계에서 브라우저 localStorage만(서버 저장 없음)
- **생물계절 판정(11-10)**: 작물이 재배되지 않는 시군·재배 기간 밖이면 위험지수 대신 '해당 없음'(사유 not_grown / off_season)으로 발행(`pipeline/phenology.py`). 해당 없음은 4단계 등급이 아니며 집계에서 제외, 화면은 무채색·점선 테두리. 모델 `season`(병해충 활동 시기, 밖이면 정상으로 캡)과는 별개. 근거 자료가 없는 작물은 판정 생략 + `status.json` 경고

## 4. 알려진 미완·TODO (코드 안 TODO와 동일)

- **홈 화면 작물별 개편(11-11)**: 전국 합계 4칸 대신 오늘의 결론 한 줄(주의보 이상 병해충 칩) + 작물 카드(재배 상태·최고 등급·병해충별 등급, 재배 시기 아닌 작물은 흐리게)
- **농사로 OpenAPI(11-11)**: 키 `NONGSARO_API_KEY`(.env, GitHub Secrets 등록됨). 이 키로 되는 것: weekFarmInfo(주간농사정보, 본문은 첨부 hwp/pdf뿐이라 재배 기간 추출에 부적합), cropEbook, monthFarmTech. **농작업일정(farmWorkingPlanNew)은 별도 키 `NONGSARO_WORKPLAN_KEY`**(농사로는 서비스 신청 건마다 인증키가 다름, 11-11 승인. GitHub Secrets 이름은 `NONGSARO2_API_KEY`). `workScheduleEraInfoLst?cntntsNo=` 응답 htmlCn(CDATA)의 tblSchedule 표로 고추 30600·벼 30697·사과 30663 시기를 API로 재확인 — 웹 페이지 값과 동일
  - 벼 수확 종료 10-31 반영(기계이앙 "수확할때 10월 상순~하순", cntntsNo 30697). 제주권 벼는 이앙 시작 근거가 없어 판정 생략(서귀포 9지점)
  - 고추(보통재배, 30600) 수확 종료 11-10 반영: 같은 표 재해 행 "냉해, 수확기 단축 10월 중순~11월 상순". 다른 후보(붉은고추 수확 끝 09-30, 연장재배 끝 11-20)는 yaml 주석. 담당 연구자 검토 대상
- **과거 비교(되돌려 보기, 11-11)**: 병해충 상세 '과거 비교' 탭 — 연도·예찰 조사일·모델을 골라 그날 위험지수와 실제 피해과율을 시군별로 비교(맞힘/놓침/헛경보). 자료 `pipeline/survey_backtest.py` → `data/backtest/<pest>.json`(배포 모델 파일로 계산, 예보 오차 미포함) → publish가 `public/data/backtest/`로 복사. 학습 연도(2015~2022)는 '학습에 쓴 해'로 경고. 시험 연도 앙상블 정확도 84.8%로 검증 결과와 일치 확인. 지도 표시는 아직 없음(표)
- **DEM 지형 피처 분석(11-12)**: 국토지리정보원 한반도 90m DEM(저장소 밖 `참고자료/`, 524MB) → `scripts/build_terrain_features.py`(rasterio·scipy) → `data/reference/terrain_spots.csv`(206지점)·`terrain_sigungu.csv`(230시군, 전체·완경사지 통계). 피처: 고도·경사·사면향(북향/동향)·TPI(0.5km·2km)·기복(2.5km)·바다까지 거리. 관측지점 설치고도와 상관 0.97. `pipeline/terrain_eval.py` 결과(고추 탄저병, 시험 2023~2025): 예찰+기상 모델에 지형 추가 시 AUC 0.902→0.901(변화 없음), 같은 회차 AUC 0.759→0.789; 기상만 모델은 AUC 0.841→0.848, 같은 회차 0.572→0.646. 처음 보는 시군(시군 묶음 교차검증) 같은 회차 0.563→0.592. 시군 발생률은 완경사지 고도(ρ=−0.30)·바다 거리(ρ=−0.26)와 음의 상관. 결론: 보조 피처로 소폭 이득(예찰 없는 시군·같은 날 시군 순위), 아직 모델에는 미반영
- **구글 로그인(11-12)**: `/api/auth/google`(시작, state 쿠키) → `/api/auth/google/callback`(토큰 교환, id_token 발급자·대상·만료·email_verified 확인) → 역할만 담은 서명 쿠키. 이메일은 저장하지 않음. Vercel 환경변수 `GOOGLE_CLIENT_ID`·`GOOGLE_CLIENT_SECRET`(있으면 로그인 필수), `ALLOWED_EMAILS`(쉼표, "@도메인" 허용, 비우면 구글 계정 누구나), `ADMIN_EMAILS`. Google Cloud 승인된 리디렉션 URI: `https://pest-forecast.vercel.app/api/auth/google/callback`. 운영 설정 완료(11-12): Google Cloud 프로젝트 pest-forecast-514423, 브랜딩(홈페이지·/privacy·승인 도메인 pest-forecast.vercel.app), 프로덕션 게시, 웹 클라이언트 pest-forecast-web. Vercel에 GOOGLE_CLIENT_ID·SECRET·ADMIN_EMAILS·AUTH_SECRET 설정 → 운영 사이트 로그인 필수 확인. TODO: 보안 비밀번호가 채팅 화면 캡처에 노출됨 → 새 비밀번호 추가·교체 후 기존 것 사용 중지, /privacy 문의처 기재
- **예측 지도 시군 색 보기(11-12)**: 지도 오른쪽 '지점/시군' 전환(`?view=sgg`). 경계 `apps/web/public/geo/sigungu.json`(230개, 0.46MB) ← `scripts/build_sigungu_boundaries.py`(vuski/admdongkor 2026.10.1. 행정동 경계 CC BY 4.0, 원자료 통계청 SGIS 공공누리 1유형 · 원본은 data/cache/boundary, shapely 필요). 최신 행정구역(전남광주통합특별시 → 자치구는 광주·시군은 전남 키로, 인천 구 개편 반영)이라 지점→시군은 좌표 포함 판정(`lib/sgg.ts`). 시군 값 = 시군 안 지점 최고 위험지수, 지점 없는 시군은 가장 가까운 지점(거리 표시). 연속 색(등급 경계에서 등급색)
- **접속 코드 로그인·관리자 메뉴(11-12)**: 회원가입·개인정보 없이 접속 코드 하나로 로그인(`apps/web/middleware.ts`, `lib/auth.ts`, `/login`, 서명 쿠키 30일). Vercel 환경변수 `SITE_ACCESS_CODE`(일반, 비우면 공개), `ADMIN_ACCESS_CODE`(관리자: 데이터·API, 검증·소개 — 비우면 아무도 못 엶), `AUTH_SECRET`(쿠키 서명). 로그인이 켜지면 /data/*.json·/api/v1도 쿠키 필요(외부 API 이용자는 추후 토큰 방식 검토). /api/cron은 CRON_SECRET로 별도 보호
- **화면 정리(11-12)**: 병해충 메뉴를 작물 선택(한 줄 칩, 위험 높은 재배 중 작물 기본) → 병해충 목록(행)으로, 페이지 머리(PageHeader·병해충 상세 히어로) 높이 축소
- **연도별 발생 추이(11-12)**: 병해충 상세 '연도별 발생' 탭 — NCPMS 시군 예찰로 연도별 발생 시군 비율·평균 피해율, 조사 시기별 곡선(선택 연도 vs 평균), 표. `pipeline/survey_trend.py`(항목 정확한 이름 ITEMS) → `data/trend/<pest>.json` → publish 복사. 자료: 고추 3종 2015~2025, 사과 2종 2021~2025(2015~2020은 일일 호출 한도로 미수집: `scripts/fetch_survey.py --crop FT010601 --examin 01322 --item 탄저병 --pest apple_anthracnose --years 2015-2020`, 연 약 90건), 벼 3종 미수집(`--predictn 00204 --crop FC010101`, 항목명 확인 후 ITEMS 추가)
- **과거 비교 지도(11-12)**: 표/지도 전환, 지도 색 = 예측 등급(굵은 테두리 = 실제 발생) 또는 판정. 시군 대표 좌표(sigungu_centroids.csv)
- **GIS 피처 후보 조사(11-12)**: 관측지점 상세정보 `Instl_Al`(고도, 단위 확인 필요)·`Clmt_Zone_Code` 즉시 사용 가능, 흙토람 토양특성 통계 V2(data.go.kr 15144796, 법정동코드 시군 단위, KOGL 4유형 상업이용 금지), 팜맵 조회(15057368, 좌표 반경 1km 필지 구분). 토지피복(EGIS WMS만)·DEM 경사는 파일 처리 필요
- **화면 날짜 표기(11-11)**: 사용자 요청으로 점 형식(2026.11.11. / 9.30.), `apps/web/lib/format.ts`. 데이터·API는 ISO 유지

- 로컬 PC 환경: Python은 `.venv`(`.\.venv\Scripts\python.exe`), Node.js·git 설치 완료. 6절 지시문 1)~4) 완료(11-10). GitHub 원격 저장소 https://github.com/reachsg1/pest-forecast (main, 11-10 push). Actions Secrets 등록·daily-forecast 첫 수동 실행 성공(11-11, 21분, 206지점). **Vercel 배포: https://pest-forecast.vercel.app** (Root Directory apps/web, 환경변수 없음, Hobby). 배치 커밋마다 자동 재배포. 배포별·브랜치 URL은 Vercel 인증 보호(정상), 공개 주소는 위 운영 주소
- 웹 의존성: `recharts@2.x`는 지원 종료(deprecated) 경고 → v3 이전 검토
- 지도 타일: 위성은 개발용 Esri World Imagery(지명 영문), 일반은 OSM. 운영 전 VWorld 위성·하이브리드·기본 타일(API 키)로 교체 — `components/MapView.tsx` MAP_STYLE, 홈 히어로 배경 `app/page.tsx`
- 생물계절 자료(우선): ① ~~시군 재배면적 수집~~ 11-10 완료(`scripts/fetch_cultivation.py`, 2025년, `cultivation.csv`). 비재배지 기준 면적 `config.MIN_CULTIVATION_HA = 1.0` 으로 확정(11-10 사용자 결정) → 비재배지 시군(전국 209): 사과 44·벼 31·고추 21. 참고로 0 ha → 14·24·0, 10 ha → 104·39·39 ② 사과·벼·고추 재배 기간을 근거와 함께 `crop_calendar.yaml`에 입력(권역 정의도 확정) ③ 연도별로 변하는 시기 자동화: 사과 만개일 API(data.go.kr 15041539), 과수 휴면타파시기 API(15168306, 67개 지점) 수집기 → 재배 기간 시작일 갱신
- 정적 JSON 브라우저 캐시 `max-age=600`(`next.config.ts`): 배치 직후 최대 10분간 파일별로 어제·오늘 데이터가 섞여 보일 수 있음. 운영 전 파일명에 기준일 버전을 붙이거나 캐시 시간 조정 검토

- `pipeline/config.py`: FIELD_CANDIDATES 실제 태그로 확정. NCPMS 서비스 코드는 11-10 공식 명세로 확정(예찰 SVC51~53 추가, 발생정보는 OpenAPI 미제공) — 조사 결과·대상 확대안은 `docs/ncpms-research.md`
- 고추 담배거세미나방 → 담배나방 교체 완료(11-10). 담배나방 파라미터는 이대홍 외(2025) 근거, 단 기산일·구간 폭(ramp_dd)·상한온도는 TODO. 확대 1·2순위 후보는 `docs/ncpms-research.md` 5절
- **예찰 실시간 연동·가까운 시군 대체 완료(11-10)**: 새 모델 `pepper_anthracnose__survey_hist`('예찰+기상 학습형', 시험 AUC 0.898·같은 회차 0.758). 매일 배치(`cli run`)가 `pipeline/survey_live.py`로 올해 NCPMS 예찰을 받아(회차 목록 하루 캐시, 회차 값 영구 캐시, 실행당 상한 150건) 지점별 '그날 이전 최신 예찰값'을 모델에 넘긴다. 데모는 전년도 실제 예찰값을 날짜만 옮겨 씀(status.json `survey`에 표시)
  - 짝짓기(`pipeline/regions.py`): 관측소 없는 예찰 시군 → 관측 자료가 있는 가장 가까운 시군(학습 11개 시군, 최대 25.9km), 예찰 없는 지점 → 가장 가까운 예찰 시군. 매 실행 다시 계산하므로 그 시군 관측소·예찰이 생기면 자동으로 자기 자료를 쓴다. 거리 상한 없음(사용자 결정) — 섬·해안은 멀 수 있음(데모 제주→진도 112km, 실데이터 통영→여수 70km). 지점 패널에 '반영한 예찰 시군·날짜·값·대체 거리' 표시
  - 시군 대표 좌표 `data/reference/sigungu_centroids.csv`(OSM Nominatim). 관측소 주소 보정: 시도 없는 주소(나주시 봉황면), 군위군 경북→대구(2023)
  - 라이브 점검(2025-08-20, 3지점): 농업기상·예찰 연동 정상. 기상청 단기예보(15084084)도 승인·확인(11-10): 오늘 기준 3지점 실행에서 예보 3일 + 지속성 7일, 올해 예찰(2026, 67개 시군, 마지막 회차 9/1, 호출 71건) 정상. 중기예보 연동 코드 완료(11-10, `fetch/kma.py` MidForecaster): 지점 → 가장 가까운 중기기온 도시 38곳·육상 구역(`data/reference/kma_mid_regions.csv`, `scripts/build_kma_mid_regions.py`), 예보 날씨에 비·눈·소나기가 있으면 비 오는 날(최근 비 온 날 평균 강수). 지속성 구간의 '매일 약한 비' 문제도 고침. 중기예보 승인·실호출 확인(11-10): 18시 발표분은 5~10일 뒤(4일째는 지속성으로 채움), 울릉도 11E00000은 NO_DATA라 11H10000(대구·경북) 사용이 맞음. 실데이터 실행은 농업기상을 월 1회 전국 일괄 수신(`fetch_month_all`)으로 바꿔 206지점 전체를 한 번에 돌림(관측 ~11건 + 단기예보 격자별 + 중기예보 구역별 호출)
- **예찰 학습형 파일럿(고추 탄저병) 완료(11-10)**: NCPMS 시군구 예찰 2015~2025 × 같은 시군 농업기상 관측소로 로지스틱 학습 → `models/pepper/anthracnose/variants/survey_logit`(라벨 '예찰 학습형'). 시험 2023~2025 AUC: 예찰 학습형 0.835 / 계절 평균 0.82 / **현재 기본 감염조건형 0.53(무작위 수준)**. 같은 회차 시군 간 변별력은 0.56으로 약함 — 성능 대부분이 시기 맞추기. 직전 회차 예찰값을 더하면 AUC 0.90·같은 회차 0.75(운영엔 예찰 실시간 연동 필요 → 다음 과제). 재현: `scripts/fetch_weather_all.py`, `scripts/fetch_survey.py`, `python -m pipeline.survey_train --pest pepper_anthracnose [--with-history]`. 검증 탭에 비교표 표시
- 관측지점 상세정보(15073274) 승인·연결(11-10): `data/reference/agri_stations.csv`(206지점, 주소·좌표). 예찰 매칭을 설치 주소의 '시도 시군' 기준으로 바꿈(옛 행정명 여주군·당진군·청원군 보정) → 64개 시군, 학습 3,059·시험 1,085건, 결과 거의 동일(AUC 0.835 / 직전 예찰값 포함 0.899). 관측소가 없는 시군(함양·고창·서산·괴산·단양·보은 등, 507건)은 제외 — 인접 시군 대체는 하지 않음. `--export <variant 폴더>`로 params·eval.json 갱신
- **재배 기간(crop_calendar.yaml) 입력(11-10)**: 공식 근거가 있는 날짜만. 사과 전국 03-11~11-10(농사로 농작업일정), 벼 이앙 시작 권역별(중부 05-08·영남 05-10·호남 05-25, 농진청 2009 이앙적기), 고추 정식 시작(남부 04-21·중부 05-01, 농사로). 벼·고추 수확 종료는 공식 날짜가 없어 `end` 비움 → 시작일 이전만 '재배 시기 아님'. 남부/중부 배정은 통상 지방 구분(출처에 기준 없음), 남부 벼 조기재배(4월 이앙)는 미반영
  - 보완 후보: 농촌진흥청 주간농사정보(공공데이터포털 3060744, 유형 LINK → **농사로 OpenAPI 키 별도 필요**)의 주별 영농 문구로 수확 종료 시기 근거 확보, 기상청 평년 첫서리일(고추 '서리 전 수확' 원칙)
- **여러 알고리즘 예측 모델(11-11)**: 고추 탄저병에 Random Forest·XGBoost(유형 D)와 앙상블(유형 E, 로지스틱·RF·XGB 평균) 추가 → 모델 6개(규칙형 기본 + 로지스틱 2 + RF + XGB + 앙상블). 시험 2023~2025(1,241건): 앙상블 AUC 0.902·정확도 84.8%, RF 0.901·85.3%, XGB 0.901·83.8%, 로지스틱(예찰+기상) 0.898·83.7%, 로지스틱(기상만) 0.836·74.9%, 기본 규칙형 0.542·49.2%. 알고리즘 간 차이는 작음. `pipeline/survey_ml.py`, 하이퍼파라미터는 학습 연도 교차검증(RF 잎 최소 20, XGB 깊이 3·나무 200)
  - 화면: 지도 모델 선택이 4개 넘으면 목록(이름·정확도·AUC), 지점 패널 '한눈에 보는 안내'(선택 모델 등급, 검증 모델 합의 수, 가장 정확한 모델 판단, 최근 7일 기상 수치, 가까운 예찰값, 등급별 권고), 검증 탭에 정확도 열
  - 결정(11-11): 고추 탄저병 기본 모델을 앙상블로 변경(`model.yaml` `default_variant: survey_ens`). 홈 요약·등급 집계·risk/pepper_anthracnose.json이 앙상블 기준, 규칙형은 비교용 추가 모델로 남음. 앙상블 결과가 없으면 규칙형으로 자동 대체
- **배치 안전장치(11-11)**: Secrets 없이 돈 첫 예약 실행이 몰래 데모로 바뀌어 실데이터를 덮어쓴 사고 → daily.yml이 키가 없으면 실패(이슈 자동 생성)하고, 데모는 수동 실행에서 demo를 체크할 때만. publish가 이번 실행에 없는 지점·모델 파일을 지움(데모·실데이터 섞임 방지)
- **실데이터 전국 실행(11-10)**: 206개 관측소 × 10개 모델, 약 6분, 결측 3.2%, 경고 0. 웹 데이터가 데모에서 실데이터(2026-11-10)로 바뀜(데모 지점 파일 삭제). 일별 스냅샷은 Parquet(약 0.1MB)만 커밋하고 CSV(약 9MB)는 .gitignore. `apps/web/public/data`가 약 28MB(지점 파일 206개)라 매일 커밋하면 저장소가 커짐 → 운영 전 지점 시계열 축소나 별도 저장소(브랜치·오브젝트 스토리지) 검토
- 실 API 연결 확인(11-10, 키는 루트 `.env`·git 제외): NCPMS 예찰 SVC51~53 정상 — 2015~2025, 매월 1·16일 회차(6~9월), 시군구별 조사값(예: 탄저병 피해과율). 농업기상 V3 일자료 정상 — 월 1회 호출로 전국 약 210지점, 결로시간(분) 포함. 관측지점 목록 서비스(15073274)도 승인됨(같은 키). 다음: 예찰 학습형 모델 파일럿(예찰 시군 ↔ 같은 시군 관측소 매칭)
- 추가 모델(variants) 후보 조사 완료(11-10): `docs/model-candidates.md`. 바로 구현 가능 = 사과 탄저병 Magarey GIM, 잎도열병 BLASTAM. 복숭아순나방 Kim 2026은 식 표기 저자 확인 후, EPIRICE(도열·잎집)는 SEIR 새 유형 필요. 고추 3종은 원문 계수 확보가 먼저. 현재 지도 모델 선택은 데모 전용 가상 모형만 있음
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
