import Link from "next/link";
import NavLinks from "./NavLinks";

export default function Header({ demo }: { demo?: boolean }) {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/80 backdrop-blur-md supports-[backdrop-filter]:bg-white/70">
      <a href="#main" className="sr-only sr-only-focusable">
        본문 바로가기
      </a>
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          <span aria-hidden="true" className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-sm">
            <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 19c0-8 5-14 15-14 0 10-6 15-14 15M5 19l7-7" />
            </svg>
          </span>
          <span className="leading-tight">
            <span className="block text-[15px] font-bold tracking-tight text-slate-900">병해충 발생 예측</span>
            <span className="hidden text-[11px] font-medium text-slate-400 sm:block">농촌진흥청 · 농업기상 기반</span>
          </span>
        </Link>
        <NavLinks />
        {demo && (
          <span className="ml-auto hidden items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 ring-1 ring-inset ring-amber-200 sm:inline-flex md:ml-0" title="합성 기상으로 만든 데모 데이터입니다">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            데모 데이터
          </span>
        )}
      </div>
    </header>
  );
}
