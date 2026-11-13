import type { Metadata } from "next";
import { cookies } from "next/headers";
import { AUTH_COOKIE, authConfig, readSession, safeNext } from "@/lib/auth";
import { featurePath, px, py } from "@/lib/mapColor";
import { todayMap } from "@/lib/todayMap";

export const metadata: Metadata = { title: "로그인", robots: { index: false } };
export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  "1": "코드가 맞지 않아요. 다시 확인해 주세요.",
  social_denied: "이 계정은 이용이 허용되지 않았어요. 담당 기관에 문의하세요.",
  google_denied: "이 계정은 이용이 허용되지 않았어요. 담당 기관에 문의하세요.",
  social_state: "로그인 시간이 지났거나 요청이 바뀌었어요. 다시 시도해 주세요.",
  google_state: "로그인 시간이 지났거나 요청이 바뀌었어요. 다시 시도해 주세요.",
  social_token: "로그인을 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.",
  google_token: "로그인을 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.",
  social_cancel: "로그인을 취소했어요.",
  google_off: "구글 로그인이 아직 설정되지 않았어요.",
  kakao_off: "카카오 로그인이 아직 설정되지 않았어요.",
  naver_off: "네이버 로그인이 아직 설정되지 않았어요.",
};

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"
      />
    </svg>
  );
}

// 카카오 로그인 버튼 가이드: 배경 #FEE500, 말풍선 심볼 #000000, 레이블 85% 검정
function KakaoMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path
        fill="#000"
        d="M12 3C6.48 3 2 6.48 2 10.78c0 2.78 1.86 5.22 4.66 6.6l-.95 3.48c-.08.3.26.54.52.37l4.13-2.73c.54.06 1.08.09 1.64.09 5.52 0 10-3.48 10-7.81S17.52 3 12 3Z"
      />
    </svg>
  );
}

// 네이버 로그인 버튼 가이드: 배경 #03C75A, 흰색 N 로고
function NaverMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        fill="#fff"
        d="M15.56 12.85 8.17 2H2v20h6.44V11.15L15.83 22H22V2h-6.44v10.85Z"
      />
    </svg>
  );
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; reason?: string }>;
}) {
  const { next, error, reason } = await searchParams;
  const cfg = authConfig();
  const admin = reason === "admin";
  const nextPath = safeNext(next);
  const showCode = admin
    ? cfg.admin !== ""
    : cfg.site !== "" || cfg.admin !== "";
  const social = cfg.google || cfg.kakao || cfg.naver;
  // 카카오로 로그인했는데 관리자가 아닌 경우: 관리자 지정에 쓸 회원번호를 보여 준다
  const session = await readSession(
    (await cookies()).get(AUTH_COOKIE)?.value,
    cfg.secret,
  );
  const kakaoNo =
    admin && session?.sub?.startsWith("k") ? session.sub.slice(1) : null;
  const map = admin ? null : await todayMap("rgba(255,255,255,0.06)");
  // 맛보기: 중부~남부 내륙을 확대(가장자리는 흐리게) — 전체 지도는 로그인 뒤에
  const vb = [px(126.15), py(37.35), px(129.45) - px(126.15), py(35.25) - py(37.35)].map((v) => v.toFixed(1)).join(" ");
  const href = (p: string) =>
    `/api/auth/${p}?next=${encodeURIComponent(nextPath)}`;
  const btn =
    "flex w-full items-center justify-center gap-2.5 rounded-xl px-4 py-2.5 text-sm font-semibold shadow-sm transition";

  const FEATURES = [
    [
      "시군별 위험도 지도",
      "고추·사과·벼 병해충 위험을 정상·예보·주의보·경보 4단계로",
    ],
    ["앞으로 7일 전망", "기상청 단기·중기예보로 며칠 뒤 위험까지 미리"],
    [
      "내 농장과 지금 할 일",
      "등록 약제·희석배수·수확 전 사용 시기까지 한 번에",
    ],
    ["실제 예찰로 검증", "국가 예찰(NCPMS) 자료와 비교한 정확도 AUC 0.9 안팎"],
  ];

  return (
    <div
      className={`mx-auto grid items-center gap-8 py-4 sm:py-8 ${admin ? "max-w-sm" : "max-w-5xl lg:grid-cols-[1.2fr_1fr] lg:gap-12"}`}
    >
      {!admin && (
        <section aria-label="서비스 소개" className="hero-dark">
          <div className="relative p-6 sm:p-8">
            <p className="text-xs font-medium text-emerald-200">
              농업기상 관측 206곳 · 매일 새벽 5시 갱신
            </p>
            <h2 className="mt-2 text-2xl font-bold leading-tight tracking-tight sm:text-3xl">
              우리 지역 병해충,
              <br />
              미리 알고 대비하세요
            </h2>
            {/* 오늘 지도 맛보기(링크 미리보기 그림과 같은 자료, 지도 부분만 확대) */}
            {map?.geo && map.colors.size > 0 && (
              <figure className="relative mt-5 overflow-hidden rounded-2xl border border-white/10 bg-slate-950/40 shadow-lift">
                <svg
                  viewBox={vb}
                  className="block aspect-[16/10] w-full"
                  preserveAspectRatio="xMidYMid slice"
                  role="img"
                  aria-label={`${map.caption} 지도 일부`}
                  style={{ maskImage: "radial-gradient(120% 95% at 50% 45%, #000 55%, transparent 100%)", WebkitMaskImage: "radial-gradient(120% 95% at 50% 45%, #000 55%, transparent 100%)" }}
                >
                  {map.geo.features.map((f) => (
                    <path
                      key={f.properties.key}
                      d={featurePath(f.geometry, 1)}
                      fill={map.colors.get(f.properties.key) ?? "rgba(255,255,255,0.06)"}
                      stroke="rgba(255,255,255,0.28)"
                      strokeWidth={0.35}
                    />
                  ))}
                </svg>
                <figcaption className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-slate-950/80 to-transparent px-4 pb-3 pt-10">
                  <span className="min-w-0">
                    <span className="block text-[11px] font-medium text-emerald-200">{map.mode === "live" ? "오늘의 위험 지도" : "지난 시즌 실제 발생"}</span>
                    <span className="block truncate text-sm font-semibold">{map.caption}</span>
                  </span>
                  <span className="glass-dark hidden shrink-0 rounded-full px-2.5 py-1 text-[11px] text-white/80 sm:inline">로그인하면 전국·내 지역까지</span>
                </figcaption>
              </figure>
            )}
            <ul className="mt-5 grid gap-x-5 gap-y-3 sm:grid-cols-2">
              {FEATURES.map(([t, d]) => (
                <li key={t} className="flex gap-2.5">
                  <span
                    aria-hidden="true"
                    className="mt-1 h-2 w-2 shrink-0 rounded-full bg-emerald-300"
                  />
                  <span>
                    <span className="block text-sm font-semibold">{t}</span>
                    <span className="block text-xs leading-relaxed text-white/60">
                      {d}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
      <div className="mx-auto flex w-full max-w-sm flex-col items-center">
        <span
          aria-hidden="true"
          className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-card"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-6 w-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="5" y="11" width="14" height="9" rx="2" />
            <path d="M8 11V8a4 4 0 1 1 8 0v3" />
          </svg>
        </span>
        <h1 className="mt-5 text-2xl font-bold tracking-tight">
          {admin ? "관리자 확인" : "로그인"}
        </h1>
        <p className="mt-2 text-center text-sm leading-relaxed text-slate-500">
          {admin
            ? "이 메뉴는 관리자만 볼 수 있어요."
            : "회원가입 없이 카카오·구글 계정으로 바로 들어올 수 있어요."}
        </p>

        <div className="card mt-6 w-full space-y-3 p-5">
          {error && ERRORS[error] && (
            <p
              id="login-error"
              role="alert"
              className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700"
            >
              {ERRORS[error]}
            </p>
          )}
          {kakaoNo && (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
              카카오 회원번호{" "}
              <b className="num select-all text-slate-900">{kakaoNo}</b> —
              관리자로 지정받으려면 이 번호를 담당자에게 알려 주세요.
            </p>
          )}
          {cfg.kakao && (
            <a
              href={href("kakao")}
              className={`${btn} bg-[#FEE500] text-black/85 hover:brightness-95`}
            >
              <KakaoMark /> 카카오 로그인
            </a>
          )}
          {cfg.naver && (
            <a
              href={href("naver")}
              className={`${btn} bg-[#03C75A] text-white hover:brightness-95`}
            >
              <NaverMark /> 네이버 로그인
            </a>
          )}
          {cfg.google && (
            <a
              href={href("google")}
              className={`${btn} border border-slate-200 bg-white text-slate-800 hover:bg-slate-50`}
            >
              <GoogleMark /> Google 계정으로 로그인
            </a>
          )}
          {social && showCode && (
            <div
              className="flex items-center gap-3 pt-1 text-[11px] text-slate-400"
              aria-hidden="true"
            >
              <span className="h-px flex-1 bg-slate-200" />
              또는 {admin ? "관리자 코드" : "접속 코드"}
              <span className="h-px flex-1 bg-slate-200" />
            </div>
          )}
          {showCode && (
            <form action="/api/auth/login" method="post" className="space-y-3">
              <input type="hidden" name="next" value={nextPath} />
              <label className="block">
                <span className="text-xs font-medium text-slate-500">
                  {admin ? "관리자 코드" : "접속 코드"}
                </span>
                <input
                  name="code"
                  type="password"
                  required
                  autoComplete="off"
                  aria-describedby={error ? "login-error" : undefined}
                  className="field mt-1 w-full"
                />
              </label>
              <button
                type="submit"
                className={`${social ? "btn-secondary" : "btn-primary"} w-full justify-center`}
              >
                들어가기
              </button>
            </form>
          )}
          {!social && !showCode && (
            <p className="text-center text-sm text-slate-500">
              아직 로그인 방법이 설정되지 않았어요.
            </p>
          )}
        </div>
        <p className="mt-4 text-center text-xs leading-relaxed text-slate-400">
          {social &&
            "로그인 정보(이메일·회원번호)는 이용 확인에만 쓰고 따로 저장하지 않아요. "}
          이 기기에서 30일 동안 다시 묻지 않아요.{" "}
          <a
            href="/privacy"
            className="underline underline-offset-2 hover:text-slate-600"
          >
            개인정보 처리 안내
          </a>
        </p>
      </div>
    </div>
  );
}
