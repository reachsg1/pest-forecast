import Link from "next/link";
import type { Metadata } from "next";
import RiskBadge from "@/components/RiskBadge";
import { GradeBar, Icon, PageHeader } from "@/components/ui";
import { getPests, getSummary } from "@/lib/data";
import { TYPE_LABEL } from "@/lib/grades";

export const metadata: Metadata = { title: "병해충 목록" };

export default async function PestsPage() {
  const [pests, summary] = await Promise.all([getPests(), getSummary()]);
  const byCrop = new Map<string, typeof pests>();
  for (const p of pests) byCrop.set(p.crop, [...(byCrop.get(p.crop) ?? []), p]);
  const sum = new Map(summary?.pests.map((p) => [p.pest_id, p]) ?? []);
  return (
    <div className="space-y-10">
      <PageHeader eyebrow={`예측 모델 ${pests.length}종`} title="병해충별 예측 모델" desc="작물별 병해충 모델의 발생 생태, 적용 시기, 오늘의 전국 위험도를 한눈에 봅니다. 카드를 누르면 예측 근거와 지점별 추이를 볼 수 있습니다." />
      {Array.from(byCrop.entries()).map(([crop, list]) => (
        <section key={crop} aria-labelledby={`crop-${crop}`} className="space-y-4">
          <h2 id={`crop-${crop}`} className="flex items-center gap-2 text-lg font-bold tracking-tight">
            {list[0].crop_ko}
            <span className="chip">{list.length}종</span>
          </h2>
          <ul className="grid gap-4 md:grid-cols-2">
            {list.map((p) => {
              const s = sum.get(p.pest_id);
              return (
                <li key={p.pest_id} className="card card-hover relative flex flex-col p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-lg font-bold tracking-tight">
                        <Link href={`/pests/${p.pest_id}`} className="after:absolute after:inset-0 after:rounded-2xl">
                          {p.name_ko}
                        </Link>
                      </h3>
                      <div className="mt-0.5 truncate text-xs italic text-slate-400">{p.name_sci}</div>
                    </div>
                    {s && <RiskBadge grade={s.max_grade} />}
                  </div>
                  <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-slate-600">{p.description}</p>
                  {s && (
                    <div className="mt-4">
                      <GradeBar counts={s.grade_counts} naCount={s.na_count ?? 0} compact />
                    </div>
                  )}
                  <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3 text-xs text-slate-500">
                    <span className="chip">{TYPE_LABEL[p.type]}</span>
                    <span className="chip">
                      {p.season.start_month}~{p.season.end_month}월
                    </span>
                    <span className="chip">v{p.version}</span>
                    <span className="ml-auto inline-flex items-center gap-1 font-semibold text-brand-600">
                      자세히 <Icon name="arrow" className="h-3.5 w-3.5" />
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
