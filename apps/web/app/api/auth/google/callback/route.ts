import { NextResponse } from "next/server";
import { AUTH_COOKIE, SESSION_DAYS, authConfig, roleForEmail, safeEqual, safeNext, signSession } from "@/lib/auth";

const STATE_COOKIE = "pf_oauth";

function fail(url: URL, error: string) {
  const res = NextResponse.redirect(new URL(`/login?error=${error}`, url), 303);
  res.cookies.set(STATE_COOKIE, "", { path: "/api/auth/google", maxAge: 0 });
  return res;
}

/** id_token 본문(구글 토큰 엔드포인트에서 TLS로 직접 받은 토큰이라 서명 대신 발급자·대상·만료를 확인) */
function claims(idToken: string): Record<string, unknown> | null {
  try {
    const part = idToken.split(".")[1];
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "="));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(json, (c) => c.charCodeAt(0))));
  } catch {
    return null;
  }
}

/** 구글이 돌려보낸 code → 토큰 교환 → 이메일 허용 확인 → 역할만 담은 서명 쿠키(이메일은 저장하지 않음) */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const cfg = authConfig();
  if (!cfg.google) return fail(url, "google_off");

  const raw = req.headers.get("cookie")?.match(new RegExp(`${STATE_COOKIE}=([^;]+)`))?.[1];
  const [state, next] = decodeURIComponent(raw ?? "").split("|");
  const code = url.searchParams.get("code");
  if (!code || !state || !safeEqual(state, url.searchParams.get("state") ?? "")) return fail(url, "google_state");

  const tok = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: cfg.googleId,
      client_secret: cfg.googleSecret,
      redirect_uri: new URL("/api/auth/google/callback", url).toString(),
      grant_type: "authorization_code",
    }),
  }).catch(() => null);
  if (!tok?.ok) return fail(url, "google_token");
  const { id_token } = (await tok.json()) as { id_token?: string };
  const c = id_token ? claims(id_token) : null;
  const okIssuer = c && (c.iss === "https://accounts.google.com" || c.iss === "accounts.google.com");
  if (!c || !okIssuer || c.aud !== cfg.googleId || Number(c.exp) < Date.now() / 1000 || c.email_verified !== true) return fail(url, "google_token");

  const role = roleForEmail(String(c.email ?? ""));
  if (!role) return fail(url, "google_denied");

  const res = NextResponse.redirect(new URL(safeNext(next), url), 303);
  res.cookies.set(AUTH_COOKIE, await signSession(role, cfg.secret), {
    httpOnly: true,
    secure: url.protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
  res.cookies.set(STATE_COOKIE, "", { path: "/api/auth/google", maxAge: 0 });
  return res;
}
