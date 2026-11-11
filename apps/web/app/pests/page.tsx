import Link from "next/link";
import type { Metadata } from "next";
import RiskBadge from "@/components/RiskBadge";
import { GradeBar, Icon, PageHeader } from "@/components/ui";
import { getPests, getSummary } from "@/lib/data";
import { GRADES, TYPE_LABEL, gradeMeta } from "@/lib/grades";
import type { Grade } from "@/lib/types";

export const metadata: Metadata = { title: "병해충" };

const rank = (g: Grade | null | undefined) => (g ? GRADES.findIndex((x) => x.name === g) : -1);

/**
 * 작물을 먼저 고르고 그 작물의 병해충만 본다(작물이 늘어나도 한 줄 선택 + 짧은 목록으로 스크롤을 줄임).
 * 기본 선택: 오늘 위험이 가장 높은 재배 중 작물.
 */
export default async function PestsPage({ searchParams }: { searchParams: Promise<{ crop?: string }> }) {
  const { crop: cropParam } = await searchParams;
  const [pests, summary] = await Promise.all([getPests(), getSummary()]);
  const sum = new Map(summary?.pests.map((p) => [p.pest_id, p]) ?? []);

  const crops = Array.from(new Set(pests.map((p) => p.crop))).map((c) => {
    const list = pests.filter((p) => p.crop === c);
    const top = list.reduce<Grade | null>((m, p) => (rank(sum.get(p.pest_id)?.max_grade) > rank(m) ? (sum.get(p.pest_id)?.max_grade ?? m) : m), null);
    const grown = list.some((p) => (sum.get(p.pest_id)?.n_applicable ?? 0) > 0);
    return { crop: c, crop_ko: list[0].crop_ko, list, top, grown };
  });
  crops.sort((a, b) => Number(b.grown) - Number(a.grown) || rank(b.top) - rank(a.top) || a.crop_ko.localeCompare(b.crop_ko, "ko"));
  const sel = crops.find((c) => c.crop === cropParam) ?? crops[0];
  const list = sel
    ? sel.list.slice().sort((a, b) => rank(sum.get(b.pest_id)?.max_grade) - rank(sum.get(a.pest_id)?.max_grade) || a.name_ko.localeCompare(b.name_ko, "ko"))
    : [];

  return (
    <div className="space-y-5">
      <PageHeader eyebrow={`작물 ${crops.length}종 · 병해충 ${pests.length}종`} title="병해충" desc="작물을 고르면 그 작물의 병해충과 오늘 전국 위험도를 볼 수 있어요." />

      {/* 작물 선택: 한 줄, 많아지면 옆으로 넘김 */}
      <nav aria-label="작물 선택" className="no-scrollbar -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex gap-2">
          {crops.map((c) => {
            const on = c.crop === sel?.crop;
            return (
              <li key={c.crop} className="shrink-0">
                <Link
                  href={`/pests?crop=${c.crop}`}
                  scroll={false}
                  aria-current={on ? "page" : undefined}
                  className={`flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-semibold transition ${
                    on ? "border-brand-600 bg-brand-600 text-white shadow-card" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                  } ${!c.grown && !on ? "text-slate-400" : ""}`}
                >
                  {c.top && c.grown ? (
                    <span aria-hidden="true" style={{ color: on ? undefined : gradeMeta(c.top).color }}>
                      {gradeMeta(c.top).icon}
                    </span>
                  ) : (
                    <span aria-hidden="true" className={on ? "" : "text-slate-300"}>
                      –
                    </span>
                  )}
                  {c.crop_ko}
                  <span className={`num text-xs font-medium ${on ? "text-white/70" : "text-slate-400"}`}>{c.list.length}</span>
                  <span className="sr-only">{c.grown ? (c.top ? `오늘 최고 ${c.top}` : "") : "재배 시기 아님"}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {sel && (
        <section aria-labelledby="crop-pests" className="card overflow-hidden">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-5 py-3">
            <h2 id="crop-pests" className="text-base font-bold tracking-tight">
              {sel.crop_ko} 병해충 <span className="num font-medium text-slate-400">{list.length}종</span>
            </h2>
            <Link href={`/map?crop=${sel.crop}`} className="link-arrow text-xs">
              {sel.crop_ko} 지도에서 보기 <Icon name="arrow" className="h-3.5 w-3.5" />
            </Link>
          </div>
          <ul className="divide-y divide-slate-100">
            {list.map((p) => {
              const s = sum.get(p.pest_id);
              const na = (s?.n_applicable ?? 0) === 0;
              return (
                <li key={p.pest_id}>
                  <Link href={`/pests/${p.pest_id}`} className="group flex items-center gap-4 px-5 py-3.5 transition hover:bg-slate-50">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className={`text-[15px] font-semibold ${na ? "text-slate-500" : "text-slate-900"}`}>{p.name_ko}</span>
                        <span className="truncate text-xs italic text-slate-400">{p.name_sci}</span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-400">
                        <span>{TYPE_LABEL[p.type]}</span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {p.season.start_month}~{p.season.end_month}월
                        </span>
                        {na && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>오늘 재배 시기 아님</span>
                          </>
                        )}
                      </div>
                    </div>
                    {s && !na && (
                      <div className="hidden w-48 shrink-0 md:block">
                        <GradeBar counts={s.grade_counts} naCount={s.na_count ?? 0} legend={false} compact />
                      </div>
                    )}
                    <div className="flex w-20 shrink-0 justify-end">{s && !na ? <RiskBadge grade={s.max_grade} size="sm" /> : <span className="text-xs text-slate-300">–</span>}</div>
                    <Icon name="arrow" className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:text-slate-600" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
