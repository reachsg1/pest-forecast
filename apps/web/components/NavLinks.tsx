"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const NAV = [
  { href: "/map", label: "예측 지도" },
  { href: "/farm", label: "내 농장" },
  { href: "/pests", label: "병해충" },
  { href: "/data", label: "데이터·API" },
  { href: "/about", label: "검증·소개" },
];

export default function NavLinks() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const active = (href: string) => path === href || path.startsWith(href + "/");

  return (
    <>
      <nav aria-label="주 메뉴" className="hidden flex-1 md:block">
        <ul className="flex items-center gap-1">
          {NAV.map((n) => (
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
            {NAV.map((n) => (
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
          </ul>
        )}
      </div>
    </>
  );
}
