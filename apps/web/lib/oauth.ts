/**
 * 소셜 로그인 공통(구글·카카오·네이버). 흐름: /api/auth/<제공자> → 제공자 동의 → /api/auth/<제공자>/callback
 * 콜백은 code 를 토큰으로 바꾸고 신원(이메일 또는 회원번호)만 확인한 뒤 역할을 정한다. 신원 정보는 저장하지 않는다
 * (카카오만 관리자 지정 안내를 위해 회원번호를 서명 쿠키에 넣는다).
 */
import { authConfig, roleForEmail, roleForKakao, type Role } from "./auth";

export type ProviderId = "google" | "kakao" | "naver";
export const PROVIDERS: ProviderId[] = ["google", "kakao", "naver"];

export type Identity = { role: Role | null; sub: string };

export function enabled(p: ProviderId): boolean {
  const c = authConfig();
  return p === "google" ? c.google : p === "kakao" ? c.kakao : c.naver;
}

export function authorizeUrl(p: ProviderId, redirectUri: string, state: string): URL {
  const c = authConfig();
  if (p === "google") {
    const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    u.searchParams.set("client_id", c.googleId);
    u.searchParams.set("redirect_uri", redirectUri);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("scope", "openid email");
    u.searchParams.set("state", state);
    u.searchParams.set("prompt", "select_account");
    return u;
  }
  if (p === "kakao") {
    const u = new URL("https://kauth.kakao.com/oauth/authorize");
    u.searchParams.set("client_id", c.kakaoId);
    u.searchParams.set("redirect_uri", redirectUri);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("state", state);
    return u;
  }
  const u = new URL("https://nid.naver.com/oauth2.0/authorize");
  u.searchParams.set("client_id", c.naverId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("state", state);
  return u;
}

function jwtClaims(idToken: string): Record<string, unknown> | null {
  try {
    const part = idToken.split(".")[1];
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "="));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(json, (ch) => ch.charCodeAt(0))));
  } catch {
    return null;
  }
}

async function postForm(url: string, body: Record<string, string>) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
    body: new URLSearchParams(body),
  }).catch(() => null);
  return r?.ok ? ((await r.json()) as Record<string, unknown>) : null;
}

/** code → 신원·역할. 실패하면 null(토큰 오류) */
export async function identify(p: ProviderId, code: string, redirectUri: string, state: string): Promise<Identity | null> {
  const c = authConfig();
  if (p === "google") {
    const t = await postForm("https://oauth2.googleapis.com/token", {
      code, client_id: c.googleId, client_secret: c.googleSecret, redirect_uri: redirectUri, grant_type: "authorization_code",
    });
    // 구글 토큰 엔드포인트에서 TLS로 직접 받은 id_token — 서명 대신 발급자·대상·만료·이메일 인증 여부를 확인
    const cl = typeof t?.id_token === "string" ? jwtClaims(t.id_token) : null;
    const okIss = cl && (cl.iss === "https://accounts.google.com" || cl.iss === "accounts.google.com");
    if (!cl || !okIss || cl.aud !== c.googleId || Number(cl.exp) < Date.now() / 1000 || cl.email_verified !== true) return null;
    return { role: roleForEmail(String(cl.email ?? "")), sub: "" };
  }
  if (p === "kakao") {
    const body: Record<string, string> = { grant_type: "authorization_code", client_id: c.kakaoId, redirect_uri: redirectUri, code };
    if (c.kakaoSecret) body.client_secret = c.kakaoSecret;
    const t = await postForm("https://kauth.kakao.com/oauth/token", body);
    if (typeof t?.access_token !== "string") return null;
    const me = await fetch("https://kapi.kakao.com/v2/user/me", { headers: { Authorization: `Bearer ${t.access_token}` } }).catch(() => null);
    const j = me?.ok ? ((await me.json()) as { id?: number | string }) : null;
    if (!j?.id) return null;
    const id = String(j.id);
    return { role: roleForKakao(id), sub: `k${id}` };
  }
  const t = await postForm("https://nid.naver.com/oauth2.0/token", {
    grant_type: "authorization_code", client_id: c.naverId, client_secret: c.naverSecret, code, state,
  });
  if (typeof t?.access_token !== "string") return null;
  const me = await fetch("https://openapi.naver.com/v1/nid/me", { headers: { Authorization: `Bearer ${t.access_token}` } }).catch(() => null);
  const j = me?.ok ? ((await me.json()) as { resultcode?: string; response?: { email?: string } }) : null;
  if (!j || j.resultcode !== "00") return null;
  return { role: roleForEmail(String(j.response?.email ?? "")), sub: "" };
}
