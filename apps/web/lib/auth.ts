/**
 * 로그인: 접속 코드(회원가입·개인정보 없음) 또는 구글 로그인. 미들웨어(Edge)와 라우트 핸들러가 함께 쓴다 — Web Crypto만 사용.
 *
 * 환경변수(Vercel 프로젝트 설정 → Environment Variables):
 *   SITE_ACCESS_CODE      일반 이용자 접속 코드(선택)
 *   ADMIN_ACCESS_CODE     관리자 코드. 데이터·API, 검증·소개 메뉴
 *   GOOGLE_CLIENT_ID      구글 로그인(OAuth 클라이언트 ID). 있으면 '구글로 로그인'을 쓴다
 *   GOOGLE_CLIENT_SECRET  구글 OAuth 클라이언트 보안 비밀
 *   ALLOWED_EMAILS        구글 로그인 허용 목록(쉼표 구분, "@도메인"은 그 도메인 전체). 비우면 구글 계정이 있는 누구나
 *   ADMIN_EMAILS          구글 로그인 관리자 이메일(쉼표 구분)
 *   AUTH_SECRET           쿠키 서명용 임의의 긴 문자열. 바꾸면 모든 로그인이 풀린다.
 * 로그인 필요 여부: SITE_ACCESS_CODE 또는 GOOGLE_CLIENT_ID 가 있으면 로그인해야 본다. 둘 다 없으면 공개(관리자 메뉴는 잠김).
 * 구글 이메일은 허용 여부 확인에만 쓰고 쿠키·서버 어디에도 저장하지 않는다(쿠키에는 역할만).
 *
 * 쿠키 pf_auth = "<role>.<만료 epoch초>.<HMAC-SHA256 base64url>"
 */
export type Role = "user" | "admin";

export const AUTH_COOKIE = "pf_auth";
export const ROLE_HEADER = "x-pf-role";
export const SESSION_DAYS = 30;

/** 관리자만 여는 경로(메뉴에서도 숨김) */
export const ADMIN_PATHS = ["/data", "/about"];

export function isAdminPath(path: string): boolean {
  return ADMIN_PATHS.some((p) => path === p || path.startsWith(p + "/"));
}

const enc = new TextEncoder();

function b64url(buf: ArrayBuffer): string {
  let s = "";
  new Uint8Array(buf).forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

/** 길이가 달라도 시간 차이로 값을 흘리지 않게 비교 */
export function safeEqual(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

const list = (v: string | undefined) =>
  (v ?? "")
    .split(/[,\s]+/)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);

export function authConfig() {
  const site = process.env.SITE_ACCESS_CODE?.trim() ?? "";
  const admin = process.env.ADMIN_ACCESS_CODE?.trim() ?? "";
  const googleId = process.env.GOOGLE_CLIENT_ID?.trim() ?? "";
  const googleSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() ?? "";
  const google = googleId !== "" && googleSecret !== "";
  // 서명 비밀: AUTH_SECRET 권장. 없으면 비밀값들로 대신 만든다(설정 누락 시에도 위조 불가하게).
  const secret = process.env.AUTH_SECRET?.trim() || (site || admin || google ? `pf:${site}:${admin}:${googleSecret}` : "");
  return {
    site,
    admin,
    secret,
    google,
    googleId,
    googleSecret,
    allowedEmails: list(process.env.ALLOWED_EMAILS),
    adminEmails: list(process.env.ADMIN_EMAILS),
    loginRequired: site !== "" || google,
  };
}

/** 구글 로그인 이메일 → 역할(허용 안 되면 null). "@domain" 항목은 그 도메인 전체 허용 */
export function roleForEmail(email: string): Role | null {
  const { allowedEmails, adminEmails } = authConfig();
  const e = email.trim().toLowerCase();
  if (!e) return null;
  const hit = (xs: string[]) => xs.some((x) => (x.startsWith("@") ? e.endsWith(x) : e === x));
  if (hit(adminEmails)) return "admin";
  if (!allowedEmails.length || hit(allowedEmails)) return "user";
  return null;
}

/** 짧은 무작위 문자열(구글 로그인 state) */
export function randomToken(bytes = 24): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return b64url(a.buffer);
}

export async function signSession(role: Role, secret: string, days = SESSION_DAYS): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + days * 86400;
  const body = `${role}.${exp}`;
  return `${body}.${await hmac(body, secret)}`;
}

export async function verifySession(token: string | undefined, secret: string): Promise<Role | null> {
  if (!token || !secret) return null;
  const [role, exp, sig] = token.split(".");
  if ((role !== "user" && role !== "admin") || !exp || !sig) return null;
  if (Number(exp) < Date.now() / 1000) return null;
  return safeEqual(sig, await hmac(`${role}.${exp}`, secret)) ? role : null;
}

/** 입력한 코드로 역할 판정(관리자 코드가 우선) */
export function roleForCode(code: string): Role | null {
  const { site, admin } = authConfig();
  const c = code.trim();
  if (!c) return null;
  if (admin && safeEqual(c, admin)) return "admin";
  if (site && safeEqual(c, site)) return "user";
  return null;
}

/** 로그인 뒤 돌아갈 주소: 같은 사이트 경로만 허용 */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/login")) return "/";
  return next;
}
