import { NextResponse } from "next/server";
import { randomToken, safeNext } from "@/lib/auth";
import { PROVIDERS, authorizeUrl, enabled, type ProviderId } from "@/lib/oauth";

const STATE_COOKIE = "pf_oauth";

/** 소셜 로그인 시작: state(위조 방지)·돌아갈 주소를 짧은 쿠키에 두고 제공자 동의 화면으로 보낸다 */
export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const url = new URL(req.url);
  const p = provider as ProviderId;
  if (!PROVIDERS.includes(p) || !enabled(p)) return NextResponse.redirect(new URL(`/login?error=${provider}_off`, url), 303);
  const state = randomToken();
  const next = safeNext(url.searchParams.get("next"));
  const res = NextResponse.redirect(authorizeUrl(p, new URL(`/api/auth/${p}/callback`, url).toString(), state), 303);
  res.cookies.set(STATE_COOKIE, `${p}|${state}|${next}`, {
    httpOnly: true,
    secure: url.protocol === "https:",
    sameSite: "lax",
    path: "/api/auth",
    maxAge: 600,
  });
  return res;
}
