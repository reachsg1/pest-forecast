import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, ROLE_HEADER, SUB_HEADER, authConfig, effectiveRole, isAdminPath, readSession } from "@/lib/auth";

/**
 * 접속 제어: 로그인(접속 코드)이 켜져 있으면 모든 화면·데이터(/data/*.json 포함)·API에 쿠키가 필요하다.
 * 관리자 경로(데이터·API, 검증·소개)는 관리자 코드로 들어온 경우만 연다.
 * 서버 컴포넌트가 메뉴를 그릴 수 있게 확인한 역할을 요청 헤더(x-pf-role)로 넘긴다.
 */
export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const { secret, loginRequired } = authConfig();
  const session = await readSession(req.cookies.get(AUTH_COOKIE)?.value, secret);
  // 카카오 관리자 명단(KAKAO_ADMIN_IDS)은 요청마다 다시 확인 — 명단에 추가된 뒤 다시 로그인하지 않아도 된다
  const role = session ? effectiveRole(session) : null;

  const isApi = pathname.startsWith("/api/") || (pathname.startsWith("/data/") && pathname.endsWith(".json"));
  const toLogin = (reason?: string) => {
    if (isApi) return NextResponse.json({ error: "login required" }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", pathname + search);
    if (reason) url.searchParams.set("reason", reason);
    return NextResponse.redirect(url);
  };

  if (loginRequired && !role) return toLogin();
  // /data/*.json(정적 자료)은 화면이 쓰므로 일반 이용자도 연다. 관리자 경로는 화면 /data, /about
  if (isAdminPath(pathname) && !pathname.endsWith(".json") && role !== "admin") return toLogin("admin");

  const headers = new Headers(req.headers);
  headers.set(ROLE_HEADER, role ?? (loginRequired ? "" : "guest"));
  headers.set(SUB_HEADER, session?.sub ?? "");
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // 로그인 화면·로그인 처리·배치 갱신(자체 비밀값)·Next 내부 파일·아이콘은 제외
  matcher: ["/((?!login|privacy|api/auth|api/cron|_next/static|_next/image|favicon\\.ico|icon|apple-icon|robots\\.txt).*)"],
};
