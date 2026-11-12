/**
 * 로그인: 접속 코드(회원가입·개인정보 없음) 또는 구글 로그인. 미들웨어(Edge)와 라우트 핸들러가 함께 쓴다 — Web Crypto만 사용.
 *
 * 환경변수(Vercel 프로젝트 설정 → Environment Variables):
 *   SITE_ACCESS_CODE      일반 이용자 접속 코드(선택)
 *   ADMIN_ACCESS_CODE     관리자 코드. 데이터·API, 검증·소개 메뉴
 *   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET   구글 로그인
 *   KAKAO_CLIENT_ID(REST API 키) / KAKAO_CLIENT_SECRET(선택)   카카오 로그인 — 이메일 없이 회원번호만 받는다
 *   NAVER_CLIENT_ID / NAVER_CLIENT_SECRET     네이버 로그인 — 이메일을 받는다
 *   ALLOWED_EMAILS        구글·네이버 이메일 허용 목록(쉼표, "@도메인"=도메인 전체). 비우면 계정이 있는 누구나
 *   ADMIN_EMAILS          구글·네이버 관리자 이메일(쉼표)
 *   KAKAO_ALLOWED_IDS     카카오 회원번호 허용 목록(쉼표). 비우면 카카오 계정이 있는 누구나
 *   KAKAO_ADMIN_IDS       카카오 관리자 회원번호(쉼표). 회원번호는 카카오로 로그인한 뒤 관리자 메뉴를 열면 화면에 보인다
 *   AUTH_SECRET           쿠키 서명용 임의의 긴 문자열. 바꾸면 모든 로그인이 풀린다.
 * 로그인 필요 여부: 접속 코드나 소셜 로그인(구글·카카오·네이버) 중 하나라도 설정되면 로그인해야 본다. 모두 없으면 공개.
 * 이메일은 허용 여부 확인에만 쓰고 저장하지 않는다. 쿠키에는 역할과(카카오만) 회원번호 — 관리자 지정 안내용.
 *
 * 쿠키 pf_auth = "<role>.<만료 epoch초>.<sub>.<HMAC-SHA256 base64url>"  (sub: 카카오 'k<회원번호>' 또는 빈 값)
 */
export type Role = "user" | "admin";

export const AUTH_COOKIE = "pf_auth";
export const ROLE_HEADER = "x-pf-role";
export const SUB_HEADER = "x-pf-sub"; // 카카오 회원번호(k…) — 화면 표시용
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
  const kakaoId = process.env.KAKAO_CLIENT_ID?.trim() ?? "";
  const kakaoSecret = process.env.KAKAO_CLIENT_SECRET?.trim() ?? "";
  const naverId = process.env.NAVER_CLIENT_ID?.trim() ?? "";
  const naverSecret = process.env.NAVER_CLIENT_SECRET?.trim() ?? "";
  const kakao = kakaoId !== "";
  const naver = naverId !== "" && naverSecret !== "";
  // 서명 비밀: AUTH_SECRET 권장. 없으면 비밀값들로 대신 만든다(설정 누락 시에도 위조 불가하게).
  const secret = process.env.AUTH_SECRET?.trim() || (site || admin || google || kakao || naver ? `pf:${site}:${admin}:${googleSecret}:${kakaoId}:${naverSecret}` : "");
  return {
    site,
    admin,
    secret,
    google,
    googleId,
    googleSecret,
    kakao,
    kakaoId,
    kakaoSecret,
    naver,
    naverId,
    naverSecret,
    allowedEmails: list(process.env.ALLOWED_EMAILS),
    adminEmails: list(process.env.ADMIN_EMAILS),
    kakaoAllowed: list(process.env.KAKAO_ALLOWED_IDS),
    kakaoAdmins: list(process.env.KAKAO_ADMIN_IDS),
    loginRequired: site !== "" || google || kakao || naver,
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

/** 카카오 회원번호 → 역할 */
export function roleForKakao(id: string): Role | null {
  const { kakaoAllowed, kakaoAdmins } = authConfig();
  const k = id.trim();
  if (!k) return null;
  if (kakaoAdmins.includes(k)) return "admin";
  if (!kakaoAllowed.length || kakaoAllowed.includes(k)) return "user";
  return null;
}

/** 짧은 무작위 문자열(소셜 로그인 state) */
export function randomToken(bytes = 24): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return b64url(a.buffer);
}

export async function signSession(role: Role, secret: string, days = SESSION_DAYS, sub = ""): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + days * 86400;
  const body = `${role}.${exp}.${sub.replace(/[^A-Za-z0-9_-]/g, "")}`;
  return `${body}.${await hmac(body, secret)}`;
}

export type Session = { role: Role; sub: string };

/** 서명 확인. 예전 형식(<role>.<exp>.<sig>)도 받는다 */
export async function readSession(token: string | undefined, secret: string): Promise<Session | null> {
  if (!token || !secret) return null;
  const parts = token.split(".");
  const [role, exp] = parts;
  const sig = parts[parts.length - 1];
  const sub = parts.length === 4 ? parts[2] : "";
  if ((role !== "user" && role !== "admin") || !exp || !sig || parts.length < 3 || parts.length > 4) return null;
  if (Number(exp) < Date.now() / 1000) return null;
  const body = parts.slice(0, -1).join(".");
  return safeEqual(sig, await hmac(body, secret)) ? { role, sub } : null;
}

/** 쿠키의 역할 + 카카오 관리자 명단 재확인(명단 추가 후 다시 로그인 없이 반영) */
export function effectiveRole(s: Session): Role {
  if (s.role !== "admin" && s.sub.startsWith("k") && authConfig().kakaoAdmins.includes(s.sub.slice(1))) return "admin";
  return s.role;
}

export async function verifySession(token: string | undefined, secret: string): Promise<Role | null> {
  return (await readSession(token, secret))?.role ?? null;
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
