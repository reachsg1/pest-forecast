import type { Metadata } from "next";
import { safeNext } from "@/lib/auth";

export const metadata: Metadata = { title: "접속", robots: { index: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string; reason?: string }> }) {
  const { next, error, reason } = await searchParams;
  const admin = reason === "admin";
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center py-10 sm:py-16">
      <span aria-hidden="true" className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-card">
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="5" y="11" width="14" height="9" rx="2" />
          <path d="M8 11V8a4 4 0 1 1 8 0v3" />
        </svg>
      </span>
      <h1 className="mt-5 text-2xl font-bold tracking-tight">{admin ? "관리자 확인" : "접속 코드 입력"}</h1>
      <p className="mt-2 text-center text-sm leading-relaxed text-slate-500">
        {admin ? "이 메뉴는 관리자만 볼 수 있어요. 관리자 코드를 입력하세요." : "안내받은 접속 코드를 입력하세요. 회원가입이나 개인정보는 필요하지 않아요."}
      </p>
      <form action="/api/auth/login" method="post" className="card mt-6 w-full space-y-3 p-5">
        <input type="hidden" name="next" value={safeNext(next)} />
        <label className="block">
          <span className="text-xs font-medium text-slate-500">{admin ? "관리자 코드" : "접속 코드"}</span>
          <input
            name="code"
            type="password"
            required
            autoFocus
            autoComplete="off"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "login-error" : undefined}
            className="field mt-1 w-full"
          />
        </label>
        {error && (
          <p id="login-error" role="alert" className="text-xs font-medium text-rose-600">
            코드가 맞지 않아요. 다시 확인해 주세요.
          </p>
        )}
        <button type="submit" className="btn-primary w-full justify-center">
          들어가기
        </button>
      </form>
      <p className="mt-4 text-center text-xs leading-relaxed text-slate-400">이 기기에서 30일 동안 다시 묻지 않아요. 코드는 담당 기관에 문의하세요.</p>
    </div>
  );
}
