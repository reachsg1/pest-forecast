import { NA, NA_REASONS, gradeMeta } from "@/lib/grades";
import type { Grade, NaReason } from "@/lib/types";

const PAD = { sm: "px-2 py-0.5 text-xs", md: "px-2.5 py-1 text-sm", lg: "px-3 py-1.5 text-base" } as const;

/**
 * 위험도 배지. 아이콘+텍스트를 항상 함께 쓴다(색만으로 구분하지 않음).
 * grade가 null이면 '해당 없음'(등급 아님)을 무채색 점선 테두리로 표시하고 사유를 덧붙인다.
 */
export default function RiskBadge({
  grade,
  index,
  na,
  size = "md",
}: {
  grade: Grade | null;
  index?: number | null;
  na?: NaReason | null;
  size?: "sm" | "md" | "lg";
}) {
  if (grade == null) {
    const reason = na ? NA_REASONS[na].short : null;
    return (
      <span
        className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-dashed border-slate-300 bg-white font-medium text-slate-500 ${PAD[size]}`}
        title={reason ? `${NA.label} · ${reason}` : NA.label}
      >
        <span aria-hidden="true">{NA.icon}</span>
        <span>{NA.label}</span>
        {reason && <span className="font-normal text-slate-400">· {reason}</span>}
      </span>
    );
  }
  const m = gradeMeta(grade);
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full font-semibold ring-1 ring-inset ${m.bg} ${m.text} ${m.ring} ${PAD[size]}`}>
      <span aria-hidden="true" className="text-[0.85em]">
        {m.icon}
      </span>
      <span>{grade}</span>
      {index != null && <span className="num font-medium opacity-70">{Math.round(index)}</span>}
    </span>
  );
}
