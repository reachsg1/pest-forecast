import Link from "next/link";
import type { Metadata } from "next";
import RiskBadge from "@/components/RiskBadge";
import { getPests, getSummary } from "@/lib/data";
import { TYPE_LABEL } from "@/lib/grades";

export const metadata: Metadata = { title: "병해충 목록" };

export default async function PestsPage() {
  const [pests, summary] = await Promise.all([getPests(), getSummary()]);
  const byCrop = new Map<string, typeof pests>();
  for (const p of pests) byCrop.set(p.crop, [...(byCrop.get(p.crop) ?? []), p]);
  const sum = new Map(summary?.pests.map((p) => [p.pest_id, p]) ?? []);
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">병해충별 예측 모델</h1>
      {Array.from(byCrop.entries()).map(([crop, list]) => (
        <section key={crop} aria-labelledby={`crop-${crop}`}>
          <h2 id={`crop-${crop}`} className="text-lg font-semibold">
            {list[0].crop_ko}
          </h2>
          <ul className="mt-2 grid gap-3 md:grid-cols-2">
            {list.map((p) => {
              const s = sum.get(p.pest_id);
              return (
                <li key={p.pest_id} className="rounded-lg border bg-white p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <Link href={`/pests/${p.pest_id}`} className="text-base font-bold hover:underline">
                        {p.name_ko}
                      </Link>
                      <div className="text-xs italic text-gray-500">{p.name_sci}</div>
                    </div>
                    {s && <RiskBadge grade={s.max_grade} />}
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm text-gray-700">{p.description}</p>
                  <div className="mt-2 text-xs text-gray-500">
                    {TYPE_LABEL[p.type]} · v{p.version} · {p.season.start_month}~{p.season.end_month}월
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
