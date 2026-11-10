# CLAUDE.md — pest-forecast 작업 지침

농촌진흥청 병해충 발생 예측 공공서비스. 배치(Python)가 매일 위험도를 계산해 정적 JSON을 커밋하고, Next.js(Vercel)가 보여준다.
세션 시작 시 `docs/HANDOFF.md`(현재 상태·결정·TODO)를 먼저 읽는다. 설계는 `docs/design-summary.md`, 사람이 할 절차는 `docs/setup-guide.md`, 모델 작성은 `docs/model-authoring.md`. 대화는 한국어로.
큰 작업이 끝나면 `docs/HANDOFF.md`의 '검증 상태'와 'TODO'를 갱신한다.

## 구조 한눈에
- `models/<작물>/<병해충>/{model.yaml, model.py, eval.json}` — 모델 플러그인. `models/_base/`에 공통 인터페이스와 유형 A(감염조건)·B(적산온도)·C(통계형). 폴더 추가만으로 자동 등록(`registry.discover()`).
- `pipeline/` — `cli.py run [--demo]` 가 수집→정제→실행→발행. 발행 결과는 `apps/web/public/data/`(웹이 읽음)와 `data/predictions/`(스냅샷).
- `apps/web/` — Next.js 15 App Router + Tailwind. 서버 컴포넌트는 `lib/data.ts`로 JSON을 fs로 읽고, 클라이언트는 `/data/*.json`을 fetch.
- `.github/workflows/daily.yml` — 05:00 KST 배치 후 결과 커밋(→ Vercel 자동 배포). `backtest-on-pr.yml` — PR 검증.

## 꼭 지킬 규칙
- 위험도 등급은 4단계 고정: 정상 0~24 / 예보 25~49 / 주의보 50~74 / 경보 75~100. 화면에서 색만으로 등급을 구분하지 말 것(아이콘+텍스트 병기).
- **작물 생물계절을 항상 고려한다.** 작물이 재배되지 않는 지역·재배 기간이 아닌 날에 위험도를 내면 오답이다. `pipeline/phenology.py`가 `data/reference/cultivation.csv`(시군 재배면적)·`crop_calendar.yaml`(권역·시도·시군 재배 기간)로 판정해 `index=null`, `na_reason`(not_grown | off_season)으로 발행한다. '해당 없음'은 등급이 아니며(정상과 다름) 등급 집계에서 뺀다. 새 화면·API·집계를 만들 때 null 위험지수를 반드시 처리할 것. 재배 기간·면적 값도 모델 파라미터와 같이 근거 없이 만들지 않는다.
- **UI는 깔끔하고 세련되게, 한눈에 알아보기 쉽게.** 촌스러운 장식·과한 색을 피하고, 등급색은 의미 전달에만 쓴다. 정보 위계(핵심 크게, 보조는 작고 회색), 넉넉한 여백, 기존 화면과 같은 톤. 바꾼 화면은 브라우저에서 직접 확인한다.
- 외부 API 키는 환경변수(`NCPMS_API_KEY`, `DATA_GO_KR_KEY`, `KMA_API_KEY`)로만. 코드·커밋·로그에 절대 넣지 않는다. 공공데이터포털 키는 `config.normalize_key()`가 디코딩한다.
- 모델 파라미터(`model.yaml`)는 담당 연구자 검토 대상. 값을 바꾸면 `references`에 근거를 적고 `status`를 유지/갱신한다. 임의로 "그럴듯한" 수치를 만들지 말고, 모르면 TODO로 남긴다.
- 농업기상 API 응답 태그명은 미확인 상태(`pipeline/config.py` FIELD_CANDIDATES). `python -m pipeline.cli probe` 결과로 맞춘다. NCPMS 예찰·예측·발생정보 서비스 코드도 미확인(`NCPMS_SERVICE_CODES`).
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
cd apps/web && npm install && npm run typecheck && npm run build && npm run dev
```

## 지금 남은 일(우선순위)
1. `apps/web` 첫 `npm install` 후 typecheck/build 통과시키기 (이 코드는 설치 없이 문법 검사만 거친 상태)
2. `probe`로 태그 확인 → `config.py` 수정 → `spots` → `run --spots 20` 성공
3. NCPMS 서비스 코드·도감 키(`ncpms_key`) 입력 → 방제 정보 탭 자동 연동
4. 예찰조사 원본 정제(`data/survey/README.md` 형식) → 백테스트 → 검증 탭 채우기
4-1. 생물계절 자료: 시군 재배면적 수집 완료(2025, 기준 1 ha 이하 = 비재배지). 재배 기간 → `crop_calendar.yaml` 입력 필요 (`data/reference/README.md`)
5. 운영 전: OSM 타일을 VWorld로 교체(`components/MapView.tsx` MAP_STYLE), 푸터 문의처

## 하지 말 것
- `apps/web/public/data`를 손으로 편집하지 않는다(배치가 덮어씀).
- `data/cache/`는 git 제외. 커밋에 포함시키지 않는다.
- 테스트(`pipeline/tests`)를 삭제하거나 건너뛰지 않는다. 모델을 추가하면 `test_discover_finds_eight_models`의 개수를 갱신한다.
