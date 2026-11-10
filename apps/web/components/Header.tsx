import Link from "next/link";

const NAV = [
  { href: "/map", label: "예측 지도" },
  { href: "/farm", label: "내 농장" },
  { href: "/pests", label: "병해충" },
  { href: "/data", label: "데이터·API" },
  { href: "/about", label: "검증·소개" },
];

export default function Header({ demo }: { demo?: boolean }) {
  return (
    <header className="border-b border-gray-200 bg-white">
      <a href="#main" className="sr-only sr-only-focusable">
        본문 바로가기
      </a>
      <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 text-lg font-bold text-brand-dark">
          <span aria-hidden="true" className="inline-block h-6 w-6 rounded-full bg-brand" />
          병해충 발생 예측
        </Link>
        <nav aria-label="주 메뉴" className="hidden flex-1 md:block">
          <ul className="flex gap-1">
            {NAV.map((n) => (
              <li key={n.href}>
                <Link href={n.href} className="rounded px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 hover:text-brand-dark">
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <details className="relative md:hidden">
          <summary className="cursor-pointer list-none rounded border px-3 py-1 text-sm">메뉴</summary>
          <ul className="absolute right-0 z-20 mt-2 w-44 rounded border bg-white p-2 shadow">
            {NAV.map((n) => (
              <li key={n.href}>
                <Link href={n.href} className="block rounded px-3 py-2 text-sm hover:bg-gray-100">
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </details>
        {demo && (
          <span className="rounded bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900" title="합성 기상으로 만든 데모 데이터입니다">
            데모 데이터
          </span>
        )}
      </div>
    </header>
  );
}
