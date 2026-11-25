# 설치·운영 가이드 — 직접 해야 할 일

이 저장소는 코드·모델·배치·화면이 모두 준비된 상태입니다. 아래 항목은 계정·키·승인이 필요해 담당자가 직접 해야 합니다. 순서대로 하면 됩니다.

## A. 당장 (30분)

1. **API 키를 안전한 곳으로 옮기기**
   - 현재 Claude 프로젝트 지침에 NCPMS 키와 공공데이터포털 키가 평문으로 있습니다. 아래 B-3, C-3에 넣은 뒤 프로젝트 지침에서는 지우세요.
2. **GitHub 저장소 만들기**
   - 청 조직 계정(또는 개인)에서 `pest-forecast` 저장소 생성 → 이 폴더를 push
   ```bash
   cd pest-forecast
   git init && git add . && git commit -m "feat: 병해충 발생 예측 서비스 초기 구축"
   git branch -M main
   git remote add origin https://github.com/<조직>/pest-forecast.git
   git push -u origin main
   ```
3. **로컬에서 한 번 돌려보기**
   ```bash
   pip install -r requirements.txt
   python -m pipeline.cli run --demo --date 2026-07-15
   cd apps/web && npm install && npm run dev
   ```
   `http://localhost:3000` 에서 홈·지도·병해충 상세가 데모 데이터로 뜨면 정상입니다. (`npm install`은 인터넷이 필요합니다. 제 작업 환경에서는 설치가 막혀 있어 빌드를 직접 확인하지 못했으니, `npm run typecheck`·`npm run build`에서 오류가 나면 메시지를 보내 주세요.)

## B. GitHub 설정 (15분)

1. Settings → Secrets and variables → Actions → **New repository secret**
   | 이름 | 값 |
   |---|---|
   | `NCPMS_API_KEY` | NCPMS 오픈API 키 |
   | `DATA_GO_KR_KEY` | 공공데이터포털 키 (인코딩된 형태 그대로 넣어도 됨, 파이프라인이 디코딩) |
   | `KMA_API_KEY` | 기상청 단기예보 키 (C-2에서 발급, 없으면 비워 두기) |
2. Settings → Actions → General → Workflow permissions: **Read and write permissions** 체크 (배치가 결과를 커밋해야 함)
3. Actions 탭 → `daily-forecast` → **Run workflow** (demo 체크) 로 수동 실행해 커밋이 생기는지 확인

## C. 공공데이터포털 (30분 + 승인 대기)

1. **농업기상 API 운영계정 전환**: 현재 개발계정(일 1,000건). 관측지점이 수백 곳이면 하루 수집만으로 한도를 넘습니다.
   - data.go.kr → 마이페이지 → 활용신청 현황 → "농촌진흥청 국립농업과학원_농업기상 기본 관측데이터 조회" → 활용사례 등록 → 운영계정 전환 신청
   - 승인 전에는 `python -m pipeline.cli run --spots 20` 처럼 지점 수를 제한해서 돌리세요.
2. **기상청 단기예보 API 신청**: "기상청_단기예보 조회서비스" 활용신청(자동승인). 같은 계정이면 키가 같을 수 있습니다 → `KMA_API_KEY`에 넣기.
3. **응답 태그 확인**: 농업기상 API의 응답 필드명은 기술명세서(HWP)에만 있어 코드에는 '후보 태그'로 넣어 두었습니다.
   ```bash
   export DATA_GO_KR_KEY=...
   python -m pipeline.cli probe
   ```
   출력된 XML의 태그명을 `pipeline/config.py`의 `FIELD_CANDIDATES`와 비교해 다르면 추가하세요(순서 상관없음). 그 다음 `python -m pipeline.cli spots`로 지점 목록을 받습니다.

## D. NCPMS (재해대응과 협조)

1. NCPMS 로그인 → 이용안내 → **OpenAPI 안내**에서 서비스 코드표를 확인해 `pipeline/config.py`의 `NCPMS_SERVICE_CODES`에 채우기
   - 확인된 것: 병 검색 SVC01, 병 상세 SVC05. 미확인: 발생정보, 예찰 결과, 예측 지도
2. 8개 병해충의 NCPMS 도감 키(sickKey/insectKey)를 각 `models/*/*/model.yaml`의 `ncpms_key`에 넣기 → 방제 정보 탭이 자동으로 채워집니다
3. **예찰조사 원본(2015~2025)** 전체와 조사지점 좌표를 내부 협조로 받기 → `data/survey/README.md` 형식으로 정제해 `data/survey/survey.csv` 저장 → `python -m pipeline.backtest` 로 검증 지표 생성

## E. Vercel (15분)

1. vercel.com → Add New Project → GitHub 저장소 선택
2. **Root Directory: `apps/web`** (중요), Framework: Next.js
3. Environment Variables: `CRON_SECRET`(임의의 긴 문자열). 외부 API 키는 Vercel에 넣지 않아도 됩니다(1단계는 정적 JSON만 서빙). 내 농장 알림을 쓰려면 H절.
4. Deploy → 발급된 URL 확인. 이후 main에 커밋될 때마다 자동 배포, PR마다 미리보기 URL 생성
5. (선택) Settings → Domains 에서 청 도메인 연결은 정보보안 부서 협의 후

## F. 연구자 검토 (모델별)

- `models/*/*/model.yaml`의 파라미터는 일반 문헌 범위의 **초기값**입니다. 작물별 담당 연구자가 `references`에 근거를 적고 값을 확정한 뒤 `status: reviewed`로 바꿔 PR을 올리도록 안내하세요. 가이드: `docs/model-authoring.md`
- 우선순위: 사과 탄저병, 고추 탄저병·역병, 벼 잎도열병(A형 4종) → 복숭아순나방, 담배나방(B형) → C형 2종(예찰 데이터 적재 후 학습)

## G. 기관 절차

- 외부 클라우드(Vercel·GitHub) 호스팅에 대해 정보보안 담당부서와 사전 협의 (개인정보 미저장·공개 정보 서비스임을 설명)
- 지도 타일: 운영 전 OSM 타일 → VWorld(국토부) 또는 청 계약 타일로 교체 (`apps/web/components/MapView.tsx`의 `MAP_STYLE`)
- 공공누리 유형 확정, 푸터 문의처 기재 (`apps/web/components/Footer.tsx`, `app/about/page.tsx`)

## H. 내 농장 위험도 알림(Web Push, 선택 · 20분)

등록한 농장의 병해충이 **주의보 이상으로 올라간 날** 기기로 알림을 보냅니다(`apps/web/lib/pushRules.ts`). 아래 셋이 모두 있어야 켜지고, 하나라도 없으면 화면에 알림 영역이 나오지 않습니다(다른 기능은 영향 없음).

1. **구독 저장소(Redis)** — 알림 구독·농장 정보를 저장하는 Redis. Vercel Storage 에 있는 Redis 라면 어느 제공자든 됩니다.
   - **이미 Redis 가 있으면(권장, 2026-11-25 결정: `redis-almond-candle`, Redis Cloud)**: 프로젝트 → **Storage** → 목록의 그 DB 옆 **Connect** → Environments **Production·Preview** 체크 → Connect. Settings → Environment Variables 에 `REDIS_URL`이 생기면 끝(코드가 `REDIS_URL`을 읽음, `apps/web/lib/kv.ts`). 다른 앱과 같이 써도 이 앱은 `push:`로 시작하는 키만 쓰므로 섞이지 않습니다. 무료 용량(Redis Cloud 30MB)이면 구독 1건 약 1~2KB 라 1만 건 이상 들어갑니다.
   - **새로 Upstash 를 만들 때**(팀에 Upstash 무료 DB 가 아직 없을 때만 Free 가 보임):
   1. vercel.com 로그인 → 이 프로젝트 → 상단 탭 **Storage** → **Create Database**(또는 Browse Marketplace).
   2. 목록에서 **Upstash** → **Upstash for Redis**(이름이 'Redis Compatible Database'로 보일 수 있음) → **Continue**.
   3. 플랜 **Free** 선택(하루 1만 명령·256MB. 구독 수천 건·매일 발송 1회면 충분) → **Continue**.
   4. 데이터베이스 이름(예 `pest-forecast-push`), Primary Region은 **Asia Pacific (Seoul)** 이 있으면 그것, 없으면 **Japan (Tokyo)** → **Create**.
   5. 바로 나오는 **Connect Project** 화면(안 나오면 Storage 탭에서 그 DB → Connect Project): 이 프로젝트 선택, Environments는 **Production·Preview** 체크, Environment Variables Prefix는 **기본값(KV)** 그대로 → **Connect**.
   6. 확인: 프로젝트 → **Settings → Environment Variables**에 `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `KV_REST_API_READ_ONLY_TOKEN`, `KV_URL`, `REDIS_URL`이 생겼으면 됩니다. 코드는 `KV_REST_API_URL`·`KV_REST_API_TOKEN` 두 개만 씁니다(`UPSTASH_REDIS_REST_URL`·`UPSTASH_REDIS_REST_TOKEN` 이름으로 들어와도 됨, `apps/web/lib/kv.ts`). 값은 복사하거나 적어 두지 않습니다.
   7. 환경변수는 **다음 배포부터** 적용되므로 2·3번까지 마친 뒤 **Deployments → 최신 배포 → ⋯ → Redeploy** 한 번.
   - 어느 쪽이든 설정 뒤 `/api/push/config`가 `{"enabled":true,…}`를 돌려주면 저장소·VAPID 가 모두 잡힌 것입니다.
2. **VAPID 키**: 로컬에서 한 번만
   ```bash
   cd apps/web && npx web-push generate-vapid-keys
   ```
   출력된 Public Key → `VAPID_PUBLIC_KEY`, Private Key → `VAPID_PRIVATE_KEY`, 운영 연락처 `VAPID_SUBJECT=mailto:담당자@기관.go.kr`를 Vercel Environment Variables(Production·Preview)에 등록. 비공개키는 어디에도 적어 두지 않습니다(바꾸면 모든 구독이 무효가 되어 이용자가 다시 켜야 함).
3. **발송 호출**: GitHub 저장소 Settings → Secrets에 `CRON_SECRET`(Vercel과 **같은 값**), Variables에 `SITE_URL`(예: `https://pest-forecast.vercel.app`). 매일 배치가 결과를 커밋한 뒤 재배포를 기다려 `/api/cron/notify`를 부릅니다. `apps/web/vercel.json`의 예비 크론(07:30 KST)도 하루 한 번 같은 주소를 부르며, 같은 날 중복 발송은 없습니다.
4. 확인: 재배포 뒤 내 농장 화면에 '위험도 알림' 카드가 보이면 설정 완료. 알림 켜기 → 권한 허용 → 상태가 '켜짐'. iPhone은 Safari '홈 화면에 추가' 뒤 그 아이콘으로 열어야 켤 수 있습니다(iOS 16.4+).
5. 개인정보 처리 안내(`/privacy`) 3절에 저장 항목을 적어 두었습니다. 기관 양식이 있으면 맞춰 고치세요.

## 완료 확인 체크리스트

- [ ] 프로젝트 지침에서 키 삭제
- [ ] GitHub 저장소 push, Secrets 3개 등록, Actions 쓰기 권한
- [ ] `daily-forecast` 수동 실행 성공(데모)
- [ ] `probe`로 태그 확인 후 `spots` 실행, `run --spots 20` 성공(라이브)
- [ ] Vercel 배포 URL에서 지도 표시
- [ ] 운영계정 전환 신청
- [ ] NCPMS 서비스 코드·도감 키 입력
- [ ] 예찰 원본 확보 → survey.csv → 백테스트
- [ ] 모델별 담당 연구자 지정
