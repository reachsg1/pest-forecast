# CLAUDE.md — pest-forecast 작업 지침

농촌진흥청 병해충 발생 예측 공공서비스. 배치(Python)가 매일 위험도를 계산해 정적 JSON을 커밋하고, Next.js(Vercel)가 보여준다.
세션 시작 시 `docs/HANDOFF.md`(현재 상태·결정·TODO)를 먼저 읽는다. 설계는 `docs/design-summary.md`, 사람이 할 절차는 `docs/setup-guide.md`, 모델 작성은 `docs/model-authoring.md`. 대화는 한국어로.
큰 작업이 끝나면 `docs/HANDOFF.md`의 '검증 상태'와 'TODO'를 갱신한다.

## 구조 한눈에
- `models/<작물>/<병해충>/{model.yaml, model.py, eval.json}` — 모델 플러그인(기본 모델). `models/_base/`에 공통 인터페이스와 유형 A(감염조건)·B(적산온도)·C(통계형·로지스틱)·D(학습한 ML: RF·XGBoost, `ml.py`)·E(앙상블 평균, `run_models.combine_ensembles`). 폴더 추가만으로 자동 등록(`registry.discover()`).
  - 예찰값을 입력으로 쓰는 모델(`params.survey` + 피처 `prev_survey_log`)은 배치가 `pipeline/survey_live.py`로 NCPMS 예찰을 받아 `predict(weather, history)`에 넘긴다. 관측소·예찰이 없는 시군은 `pipeline/regions.py`가 가장 가까운 시군으로 대체(매 실행 재계산 → 자료가 생기면 자동 보완).
  - 같은 병해충의 추가 모델은 `<병해충>/variants/<이름>/`(같은 `pest_id`, 다른 `id`, `label` 필수). 예측 지도에서 모델을 골라 결과를 비교한다(`?model=`). 요약·등급 집계는 기본 모델 기준(병해충 폴더 `model.yaml`의 `default_variant`로 variant를 기본으로 지정 가능 — 고추 탄저병은 앙상블). `demo_only: true`는 데모 실행 전용 시연 모형 — 실제 모델로 쓰지 않는다. 자세한 규칙은 `docs/model-authoring.md`.
- `pipeline/` — `cli.py run [--demo]` 가 수집→정제→실행→발행. 발행 결과는 `apps/web/public/data/`(웹이 읽음)와 `data/predictions/`(스냅샷).
- `apps/web/` — Next.js 15 App Router + Tailwind. 서버 컴포넌트는 `lib/data.ts`로 JSON을 fs로 읽고, 클라이언트는 `/data/*.json`을 fetch.
- `.github/workflows/daily.yml` — 05:00 KST 배치 후 결과 커밋(→ Vercel 자동 배포). `backtest-on-pr.yml` — PR 검증.

## 꼭 지킬 규칙
- 위험도 등급은 4단계 고정: 정상 0~24 / 예보 25~49 / 주의보 50~74 / 경보 75~100. 화면에서 색만으로 등급을 구분하지 말 것(아이콘+텍스트 병기).
- **작물 생물계절을 항상 고려한다.** 작물이 재배되지 않는 지역·재배 기간이 아닌 날에 위험도를 내면 오답이다. `pipeline/phenology.py`가 `data/reference/cultivation.csv`(시군 재배면적)·`crop_calendar.yaml`(권역·시도·시군 재배 기간)로 판정해 `index=null`, `na_reason`(not_grown | off_season)으로 발행한다. '해당 없음'은 등급이 아니며(정상과 다름) 등급 집계에서 뺀다. 새 화면·API·집계를 만들 때 null 위험지수를 반드시 처리할 것. 재배 기간·면적 값도 모델 파라미터와 같이 근거 없이 만들지 않는다.
- **UI는 깔끔하고 세련되게, 한눈에 알아보기 쉽게.** 촌스러운 장식·과한 색을 피하고, 등급색은 의미 전달에만 쓴다. 정보 위계(핵심 크게, 보조는 작고 회색), 넉넉한 여백, 기존 화면과 같은 톤. 바꾼 화면은 브라우저에서 데스크톱·모바일(375px) 모두 직접 확인한다.
  - 디자인 기반: 글꼴 Pretendard(npm `pretendard`), 색·그림자 토큰 `tailwind.config.ts`(brand-50~900, canvas, shadow-card/lift), 공통 클래스 `app/globals.css`(`.card` `.btn-primary` `.btn-secondary` `.segmented` `.field` `.table-clean` `.chip` `.page-title` 등), 공통 컴포넌트 `components/ui.tsx`(`PageHeader`, `GradeBar`, `Icon`). 새 화면은 이것을 재사용하고 임의 회색(gray-*) 대신 slate-* 를 쓴다.
  - 톤: 페이지 머리는 짙은 녹·청록 그라데이션 히어로(`.hero-dark`, `PageHeader`) + 반투명 유리 요소(`.glass-tile` `.glass-dark` `.btn-light` `.btn-glass`), 본문은 밝은 카드. 지도는 위성(기본)/일반 전환, 조건·범례는 지도 위 유리 패널. 사용자가 "구식"이라 한 흰 카드 나열형으로 되돌리지 않는다.
  - 위성 타일(Esri World Imagery)·홈 히어로 위성 배경은 개발용. 운영 전 VWorld 위성·하이브리드 타일로 교체(한글 지명).
  - 화면 날짜는 점 형식(2026.11.11. / 9.30.) — `lib/format.ts`의 fmtDate·fmtMD·fmtDateTime. 데이터·API는 ISO 유지.
  - Tailwind 설정(`tailwind.config.ts`)을 바꾸면 dev 서버를 재시작해야 반영된다. `npm run build`는 dev 서버의 `.next`를 덮어쓰므로 dev 서버를 멈추고 빌드 후 `.next`를 지우고 다시 띄운다.
- 외부 API 키는 환경변수(`NCPMS_API_KEY`, `DATA_GO_KR_KEY`, `KMA_API_KEY`, 농사로 `NONGSARO_API_KEY`·`NONGSARO_WORKPLAN_KEY`, 농약안전정보시스템 `PESTICIDE_KEY`)로만(로컬은 루트 `.env`, git 제외). 코드·커밋·로그에 절대 넣지 않는다. `fetch/http.py`가 오류·로그의 키를 가린다. 공공데이터포털 키는 `config.normalize_key()`가 디코딩한다.
- 모델 파라미터(`model.yaml`)는 담당 연구자 검토 대상. 값을 바꾸면 `references`에 근거를 적고 `status`를 유지/갱신한다. 임의로 "그럴듯한" 수치를 만들지 말고, 모르면 TODO로 남긴다.
- 농업기상 API 응답 태그명은 미확인 상태(`pipeline/config.py` FIELD_CANDIDATES). `python -m pipeline.cli probe` 결과로 맞춘다.
- NCPMS 서비스 코드는 공식 명세로 확정(`NCPMS_SERVICE_CODES`, `docs/ncpms-research.md`). 검색·예찰 계열은 `serviceType` 필수, 예측(SVC31~34)은 위젯이라 원자료 아님, 발생정보(발령)는 OpenAPI 없음. 대상 병해충을 늘릴 때는 NCPMS 예찰(검증)·예측모형(비교) 유무를 먼저 본다(`data/reference/ncpms_*.csv`).
- 개발계정 트래픽은 일 1,000건. 라이브 실행은 `--spots N`으로 제한해서 시작한다.

## 자주 쓰는 명령
```bash
pip install -r requirements.txt
python -m pytest pipeline/tests -q
python -m pipeline.cli run --demo --date 2026-07-15     # 데모 데이터 생성
python -m pipeline.cli probe && python -m pipeline.cli spots
python -m pipeline.cli run --spots 20                    # 라이브(키 필요)
python -m pipeline.backtest                              # data/survey/survey.csv 있을 때
python scripts/fetch_cultivation.py --year 2025          # 시군별 노지 재배면적 → data/reference/cultivation.csv
python scripts/fetch_weather_all.py --years 2015-2025 --months 4-9   # 전국 농업기상 일자료 캐시(월 1회 호출)
python scripts/fetch_survey.py --crop VC011205 --examin 01320 --item 탄저병 --pest pepper_anthracnose  # NCPMS 시군구 예찰
python -m pipeline.survey_train --pest pepper_anthracnose [--with-history] [--export <variant 폴더>]   # 예찰 학습형 학습·연도 분리 검증
python scripts/fetch_sigungu_centroids.py                # 시군 대표 좌표(가까운 시군 대체용)
python -m pipeline.survey_ml --pest pepper_anthracnose --export [--static terrain] [--asos]   # 로지스틱·RF·XGBoost·앙상블 비교·내보내기(학습 파일 갱신). --asos = 기상청 ASOS 새 항목(고추 역병·담배나방 배포 모델이 사용 — 다시 내보낼 때 꼭 붙일 것)
python scripts/fetch_asos.py --years 2015-2026             # ASOS 일자료 캐시(학습용, 배치는 pipeline/asos.py가 올해분만 매일 받음)
python scripts/scaffold_survey_variants.py --pest <pest> --item <예찰 항목> --unit <단위>   # 예찰 학습형 variants 뼈대
python scripts/backfill_survey.py --max-calls 700        # NCPMS 예찰 백필(매일 Actions survey-backfill.yml)
python scripts/build_control_info.py                     # 방제 요령·등록 농약(data/control)
python scripts/build_terrain_features.py --dem "<경로>/한반도90m_GRS80.img"   # DEM 지형 피처(data/reference/terrain_*.csv)
python -m pipeline.terrain_eval --pest pepper_anthracnose   # 지형 피처 효과 검증(분석용)
python -m pipeline.survey_trend                           # 연도별 발생 추이(data/trend, 예찰 CSV 갱신 후)
python -m pipeline.survey_backtest --pest pepper_anthracnose   # 과거 예찰 회차 되돌려 보기 자료(data/backtest, 모델을 다시 학습하면 함께 갱신)
cd apps/web && npm install && npm run typecheck && npm run build && npm run dev
```

## 지금 남은 일(우선순위)
1. `apps/web` 첫 `npm install` 후 typecheck/build 통과시키기 (이 코드는 설치 없이 문법 검사만 거친 상태)
2. `probe`로 태그 확인 → `config.py` 수정 → `spots` → `run --spots 20` 성공
3. NCPMS 서비스 코드·도감 키(`ncpms_key`) 입력 → 방제 정보 탭 자동 연동
4. 예찰조사 원본 정제(`data/survey/README.md` 형식) → 백테스트 → 검증 탭 채우기
4-1. 생물계절 자료: 시군 재배면적(2025, 1 ha 이하 = 비재배지)·재배 기간 시작일 입력 완료. 벼 수확 종료 10-31 반영(농사로 농작업일정). 고추 수확 종료 11-10 반영(냉해·수확기 단축 끝), 제주 벼 재배 기간 근거 없음
5. 운영 전: OSM 타일을 VWorld로 교체(`components/MapView.tsx` MAP_STYLE), 푸터 문의처

## 하지 말 것
- `apps/web/public/data`를 손으로 편집하지 않는다(배치가 덮어씀).
- `data/cache/`는 git 제외. 커밋에 포함시키지 않는다.
- 테스트(`pipeline/tests`)를 삭제하거나 건너뛰지 않는다. 모델을 추가하면 `test_discover_finds_eight_models`의 개수를 갱신한다.
- 학습 파일(`model.joblib`, `model.ubj`)을 다시 만들면 `requirements.txt`의 scikit-learn·xgboost 고정 버전과 맞춘다(버전이 다르면 배치에서 못 읽음).
