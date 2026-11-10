import { GRADES, NA } from "@/lib/grades";
import type { Grade } from "@/lib/types";

/** 페이지 머리: 짙은 그라데이션 띠 위에 분류 문구 + 제목 + 설명 + 오른쪽 동작(홈 히어로의 축소판) */
export function PageHeader({ eyebrow, title, desc, actions, children }: { eyebrow?: React.ReactNode; title: React.ReactNode; desc?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header className="hero-dark">
      <div className="relative px-6 py-8 sm:px-10 sm:py-10">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div className="min-w-0 max-w-3xl">
            {eyebrow && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-2.5 py-0.5 text-xs font-medium text-emerald-100 backdrop-blur">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                {eyebrow}
              </span>
            )}
            <h1 className="mt-3 text-2xl font-bold tracking-tight text-white sm:text-4xl">{title}</h1>
            {desc && <p className="mt-2.5 text-sm leading-relaxed text-white/65">{desc}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
        {children && <div className="mt-6">{children}</div>}
      </div>
    </header>
  );
}

/**
 * 등급 분포 막대. 지점 수 비율을 한 줄 막대로 보여 주고(색), 아래 범례에 아이콘·이름·수를 함께 적는다(색만으로 구분하지 않음).
 * naCount: 해당 없음 지점 수(막대 끝에 점선 칸으로 표시, 등급 아님)
 */
export function GradeBar({ counts, naCount = 0, legend = true, compact = false }: { counts: Record<Grade, number>; naCount?: number; legend?: boolean; compact?: boolean }) {
  const order = GRADES.slice().reverse(); // 경보 → 정상
  const total = order.reduce((a, g) => a + (counts[g.name] ?? 0), 0) + naCount;
  const label = order.map((g) => `${g.name} ${counts[g.name] ?? 0}`).join(", ") + (naCount ? `, ${NA.label} ${naCount}` : "");
  return (
    <div>
      <div className={`flex w-full overflow-hidden rounded-full bg-slate-100 ${compact ? "h-1.5" : "h-2"}`} role="img" aria-label={`등급별 지점 수: ${label}`}>
        {total > 0 &&
          order.map((g) =>
            (counts[g.name] ?? 0) > 0 ? <span key={g.name} style={{ width: `${((counts[g.name] ?? 0) / total) * 100}%`, background: g.color }} className="h-full first:rounded-l-full" /> : null,
          )}
        {naCount > 0 && (
          <span
            style={{ width: `${(naCount / total) * 100}%`, backgroundImage: `repeating-linear-gradient(45deg, ${NA.color} 0 2px, transparent 2px 5px)` }}
            className="h-full"
          />
        )}
      </div>
      {legend && (
        <ul className="mt-2.5 flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-slate-500">
          {order.map((g) => (
            <li key={g.name} className="flex items-center gap-1">
              <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full" style={{ background: g.color }} />
              {g.name}
              <b className="num font-semibold text-slate-800">{counts[g.name] ?? 0}</b>
            </li>
          ))}
          {naCount > 0 && (
            <li className="flex items-center gap-1 text-slate-400" title="비재배지·재배 시기 아님">
              <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full border border-dashed" style={{ borderColor: NA.stroke }} />
              {NA.label}
              <b className="num font-semibold text-slate-500">{naCount}</b>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/** 작은 아이콘(인라인 SVG). 외부 아이콘 라이브러리 없이 일관된 선 아이콘을 쓴다. */
export function Icon({ name, className = "h-4 w-4" }: { name: "map" | "farm" | "arrow" | "leaf" | "info" | "chart" | "close" | "location" | "plus"; className?: string }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      {name === "map" && <path {...p} d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Zm0 0v14m6-12v14" />}
      {name === "farm" && <path {...p} d="M3 21h18M5 21V10l7-5 7 5v11M9 21v-6h6v6" />}
      {name === "arrow" && <path {...p} d="M5 12h14m-6-6 6 6-6 6" />}
      {name === "leaf" && <path {...p} d="M5 19c0-8 5-14 15-14 0 10-6 15-14 15M5 19l7-7" />}
      {name === "info" && <path {...p} d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-5v-5m0-3h.01" />}
      {name === "chart" && <path {...p} d="M4 20V10m6 10V4m6 16v-7m4 7H3" />}
      {name === "close" && <path {...p} d="M6 6l12 12M18 6 6 18" />}
      {name === "location" && <path {...p} d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21Zm0-9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />}
      {name === "plus" && <path {...p} d="M12 5v14M5 12h14" />}
    </svg>
  );
}
