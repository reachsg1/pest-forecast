"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const NAV = [
  { href: "/map", label: "예측 지도" },
  { href: "/farm", label: "내 농장" },
  { href: "/pests", label: "병해충" },
];
// 관리자 코드로 들어온 경우만 보인다(미들웨어가 경로도 막음)
const ADMIN_NAV = [
  { href: "/data", label: "데이터·API" },
  { href: "/about", label: "검증·소개" },
];

function Logout({ className }: { className: string }) {
  return (
    <form action="/api/auth/logout" method="post">
      <button type="submit" className={className}>
        나가기
      </button>
    </form>
  );
}

export default function NavLinks({ isAdmin = false, canLogout = false, kakaoNo = "" }: { isAdmin?: boolean; canLogout?: boolean; kakaoNo?: string }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const active = (href: string) => path === href || path.startsWith(href + "/");
  const items = isAdmin ? [...NAV, ...ADMIN_NAV] : NAV;

  return (
    <>
      <nav aria-label="주 메뉴" className="hidden flex-1 md:block">
        <ul className="flex items-center gap-1">
          {items.map((n) => (
            <li key={n.href}>
              <Link
                href={n.href}
                aria-current={active(n.href) ? "page" : undefined}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition ${active(n.href) ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}
              >
                {n.label}
              </Link>
            </li>
          ))}
          {canLogout && (
            <li className="ml-auto flex items-center gap-2">
              {kakaoNo && (
                <span className="num select-all text-[11px] text-slate-400" title="카카오 회원번호 — 관리자 지정(KAKAO_ADMIN_IDS)에 씁니다">
                  카카오 {kakaoNo}
                </span>
              )}
              {isAdmin && <span className="chip bg-slate-900 text-white">관리자</span>}
              <Logout className="rounded-lg px-3 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-900" />
            </li>
          )}
        </ul>
      </nav>

      {/* 모바일 메뉴 */}
      <div className="ml-auto md:hidden">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="mobile-nav"
          className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-700"
        >
          <span className="sr-only">메뉴</span>
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            {open ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
        {open && (
          <ul id="mobile-nav" className="absolute inset-x-0 top-16 z-40 space-y-1 border-b border-slate-200 bg-white px-4 py-3 shadow-lift">
            {items.map((n) => (
              <li key={n.href}>
                <Link
                  href={n.href}
                  aria-current={active(n.href) ? "page" : undefined}
                  className={`block rounded-lg px-3 py-2.5 text-sm font-medium ${active(n.href) ? "bg-brand-50 text-brand-700" : "text-slate-700 hover:bg-slate-50"}`}
                >
                  {n.label}
                </Link>
              </li>
            ))}
            {kakaoNo && (
              <li className="num select-all px-3 pt-1 text-[11px] text-slate-400">카카오 회원번호 {kakaoNo}</li>
            )}
            {canLogout && (
              <li className="border-t border-slate-100 pt-1">
                <Logout className="block w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium text-slate-500 hover:bg-slate-50" />
              </li>
            )}
          </ul>
        )}
      </div>
    </>
  );
}
