import { NextResponse } from "next/server";
import { AUTH_COOKIE, SESSION_DAYS, authConfig, roleForCode, safeNext, signSession } from "@/lib/auth";

// 접속 코드 확인 → 서명 쿠키(30일). 회원 정보·개인정보는 받지도 저장하지도 않는다.
export async function POST(req: Request) {
  const form = await req.formData();
  const code = String(form.get("code") ?? "");
  const next = safeNext(String(form.get("next") ?? "/"));
  const role = roleForCode(code);
  const base = new URL(req.url);
  if (!role) {
    const back = new URL("/login", base);
    back.searchParams.set("error", "1");
    back.searchParams.set("next", next);
    return NextResponse.redirect(back, 303);
  }
  const res = NextResponse.redirect(new URL(next, base), 303);
  res.cookies.set(AUTH_COOKIE, await signSession(role, authConfig().secret), {
    httpOnly: true,
    secure: base.protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
  return res;
}
