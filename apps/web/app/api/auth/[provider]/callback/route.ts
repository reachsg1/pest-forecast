import { NextResponse } from "next/server";
import { AUTH_COOKIE, SESSION_DAYS, authConfig, safeEqual, safeNext, signSession } from "@/lib/auth";
import { PROVIDERS, enabled, identify, type ProviderId } from "@/lib/oauth";

const STATE_COOKIE = "pf_oauth";

function fail(url: URL, error: string) {
  const res = NextResponse.redirect(new URL(`/login?error=${error}`, url), 303);
  res.cookies.set(STATE_COOKIE, "", { path: "/api/auth", maxAge: 0 });
  return res;
}

/** 제공자가 돌려보낸 code → 신원 확인 → 역할(+카카오 회원번호)만 담은 서명 쿠키 */
export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const url = new URL(req.url);
  const p = provider as ProviderId;
  if (!PROVIDERS.includes(p) || !enabled(p)) return fail(url, `${provider}_off`);

  const raw = req.headers.get("cookie")?.match(new RegExp(`${STATE_COOKIE}=([^;]+)`))?.[1];
  const [cp, state, next] = decodeURIComponent(raw ?? "").split("|");
  const code = url.searchParams.get("code");
  if (url.searchParams.get("error")) return fail(url, "social_cancel");
  if (!code || cp !== p || !state || !safeEqual(state, url.searchParams.get("state") ?? "")) return fail(url, "social_state");

  const who = await identify(p, code, new URL(`/api/auth/${p}/callback`, url).toString(), state);
  if (!who) return fail(url, "social_token");
  if (!who.role) return fail(url, "social_denied");

  const res = NextResponse.redirect(new URL(safeNext(next), url), 303);
  res.cookies.set(AUTH_COOKIE, await signSession(who.role, authConfig().secret, SESSION_DAYS, who.sub), {
    httpOnly: true,
    secure: url.protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
  res.cookies.set(STATE_COOKIE, "", { path: "/api/auth", maxAge: 0 });
  return res;
}
