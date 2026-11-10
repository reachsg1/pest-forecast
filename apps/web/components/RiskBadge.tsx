import { gradeMeta } from "@/lib/grades";
import type { Grade } from "@/lib/types";

export default function RiskBadge({ grade, index, size = "md" }: { grade: Grade; index?: number; size?: "sm" | "md" | "lg" }) {
  const m = gradeMeta(grade);
  const pad = size === "sm" ? "px-1.5 py-0.5 text-xs" : size === "lg" ? "px-3 py-1.5 text-base" : "px-2 py-1 text-sm";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full font-semibold ${m.bg} ${m.text} ${pad}`}>
      <span aria-hidden="true">{m.icon}</span>
      <span>{grade}</span>
      {index !== undefined && <span className="font-normal opacity-80">{Math.round(index)}</span>}
    </span>
  );
}
