import { NextResponse } from "next/server";
import { authConfig, randomToken, safeNext } from "@/lib/auth";

const STATE_COOKIE = "pf_oauth";

/** 구글 로그인 시작: state(위조 방지)와 돌아갈 주소를 짧은 쿠키에 두고 구글 동의 화면으로 보낸다 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const cfg = authConfig();
  if (!cfg.google) return NextResponse.redirect(new URL("/login?error=google_off", url), 303);
  const state = randomToken();
  const next = safeNext(url.searchParams.get("next"));
  const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  auth.searchParams.set("client_id", cfg.googleId);
  auth.searchParams.set("redirect_uri", new URL("/api/auth/google/callback", url).toString());
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("scope", "openid email");
  auth.searchParams.set("state", state);
  auth.searchParams.set("prompt", "select_account");
  const res = NextResponse.redirect(auth, 303);
  res.cookies.set(STATE_COOKIE, `${state}|${next}`, {
    httpOnly: true,
    secure: url.protocol === "https:",
    sameSite: "lax",
    path: "/api/auth/google",
    maxAge: 600,
  });
  return res;
}
