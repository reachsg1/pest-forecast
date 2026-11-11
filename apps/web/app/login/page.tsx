import type { Metadata } from "next";
import { authConfig, safeNext } from "@/lib/auth";

export const metadata: Metadata = { title: "로그인", robots: { index: false } };
export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  "1": "코드가 맞지 않아요. 다시 확인해 주세요.",
  google_denied: "이 구글 계정은 이용이 허용되지 않았어요. 담당 기관에 문의하세요.",
  google_state: "로그인 시간이 지났거나 요청이 바뀌었어요. 다시 시도해 주세요.",
  google_token: "구글 로그인을 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.",
  google_off: "구글 로그인이 아직 설정되지 않았어요.",
};

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string; reason?: string }> }) {
  const { next, error, reason } = await searchParams;
  const cfg = authConfig();
  const admin = reason === "admin";
  const nextPath = safeNext(next);
  const showCode = admin ? cfg.admin !== "" : cfg.site !== "" || cfg.admin !== "";
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center py-10 sm:py-16">
      <span aria-hidden="true" className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-card">
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="5" y="11" width="14" height="9" rx="2" />
          <path d="M8 11V8a4 4 0 1 1 8 0v3" />
        </svg>
      </span>
      <h1 className="mt-5 text-2xl font-bold tracking-tight">{admin ? "관리자 확인" : "로그인"}</h1>
      <p className="mt-2 text-center text-sm leading-relaxed text-slate-500">
        {admin ? "이 메뉴는 관리자만 볼 수 있어요." : "병해충 발생 예측 서비스는 로그인한 분만 볼 수 있어요."}
      </p>

      <div className="card mt-6 w-full space-y-4 p-5">
        {error && ERRORS[error] && (
          <p id="login-error" role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
            {ERRORS[error]}
          </p>
        )}
        {cfg.google && (
          <a
            href={`/api/auth/google?next=${encodeURIComponent(nextPath)}`}
            className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50"
          >
            <GoogleMark /> Google 계정으로 로그인
          </a>
        )}
        {cfg.google && showCode && (
          <div className="flex items-center gap-3 text-[11px] text-slate-400" aria-hidden="true">
            <span className="h-px flex-1 bg-slate-200" />
            또는 {admin ? "관리자 코드" : "접속 코드"}
            <span className="h-px flex-1 bg-slate-200" />
          </div>
        )}
        {showCode && (
          <form action="/api/auth/login" method="post" className="space-y-3">
            <input type="hidden" name="next" value={nextPath} />
            <label className="block">
              <span className="text-xs font-medium text-slate-500">{admin ? "관리자 코드" : "접속 코드"}</span>
              <input name="code" type="password" required autoComplete="off" aria-describedby={error ? "login-error" : undefined} className="field mt-1 w-full" />
            </label>
            <button type="submit" className={`${cfg.google ? "btn-secondary" : "btn-primary"} w-full justify-center`}>
              들어가기
            </button>
          </form>
        )}
        {!cfg.google && !showCode && <p className="text-center text-sm text-slate-500">아직 로그인 방법이 설정되지 않았어요.</p>}
      </div>
      <p className="mt-4 text-center text-xs leading-relaxed text-slate-400">
        {cfg.google && "구글 계정 이메일은 이용 허용 여부 확인에만 쓰고 저장하지 않아요. "}이 기기에서 30일 동안 다시 묻지 않아요.
      </p>
    </div>
  );
}
