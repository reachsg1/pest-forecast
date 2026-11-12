import Link from "next/link";
import type { Metadata } from "next";
import { ActionBox } from "@/components/ControlGuide";
import RiskBadge from "@/components/RiskBadge";
import { Icon, PageHeader } from "@/components/ui";
import { getPests, getSummary } from "@/lib/data";
import { GRADES } from "@/lib/grades";
import type { Grade } from "@/lib/types";

export const metadata: Metadata = { title: "방제 일정" };

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const rank = (g: Grade | null | undefined) => (g ? GRADES.findIndex((x) => x.name === g) : -1);

function inSeason(m: number, s: number, e: number) {
  return s <= e ? m >= s && m <= e : m >= s || m <= e;
}

/**
 * 방제 캘린더: 작물별로 병해충 발생·방제 시기(모델 적용 시기)를 달력 막대로, 오늘 위험이 예보 이상인 병해충의 할 일을 함께 보여 준다.
 * 시기 막대 = 각 모델 카드의 season(start_month~end_month, 문헌·NCPMS 근거) — 세부 방제 적기는 병해충 상세 '방제 정보'
 */
export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ crop?: string }> }) {
  const { crop: cropParam } = await searchParams;
  const [pests, summary] = await Promise.all([getPests(), getSummary()]);
  const sum = new Map(summary?.pests.map((p) => [p.pest_id, p]) ?? []);
  const crops = Array.from(new Set(pests.map((p) => p.crop))).map((c) => ({ crop: c, crop_ko: pests.find((p) => p.crop === c)!.crop_ko }));
  const sel = crops.find((c) => c.crop === cropParam) ?? crops[0];
  const list = pests.filter((p) => p.crop === sel?.crop);
  const issued = summary?.issued_date ?? new Date().toISOString().slice(0, 10);
  const nowM = Number(issued.slice(5, 7));
  const alerts = list
    .map((p) => ({ p, g: sum.get(p.pest_id)?.max_grade ?? null }))
    .filter((x) => x.g && x.g !== "정상")
    .sort((a, b) => rank(b.g) - rank(a.g));

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="작물별 방제 시기" title="방제 일정" desc="병해충별로 발생·방제를 챙길 시기와, 오늘 위험이 높은 병해충의 할 일을 함께 봅니다." />

      <nav aria-label="작물 선택" className="no-scrollbar -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex gap-2">
          {crops.map((c) => (
            <li key={c.crop} className="shrink-0">
              <Link
                href={`/calendar?crop=${c.crop}`}
                scroll={false}
                aria-current={c.crop === sel?.crop ? "page" : undefined}
                className={`block rounded-xl border px-3.5 py-2 text-sm font-semibold transition ${c.crop === sel?.crop ? "border-brand-600 bg-brand-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"}`}
              >
                {c.crop_ko}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {/* 지금 할 일 */}
      <section aria-labelledby="todo" className="space-y-3">
        <h2 id="todo" className="section-title">
          지금 챙길 병해충 <span className="text-xs font-normal text-slate-400">· 오늘 전국 최고 등급 예보 이상</span>
        </h2>
        {alerts.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {alerts.map(({ p, g }) => (
              <ActionBox key={p.pest_id} pestId={p.pest_id} grade={g as Grade} pestName={p.name_ko} />
            ))}
          </div>
        ) : (
          <p className="card px-5 py-4 text-sm text-slate-500">오늘은 {sel?.crop_ko} 병해충 중 예보 이상인 곳이 없어요. 평소처럼 포장을 살펴보세요.</p>
        )}
      </section>

      {/* 달력 */}
      <section aria-labelledby="cal" className="card overflow-hidden">
        <h2 id="cal" className="border-b border-slate-100 px-5 py-3 text-base font-bold tracking-tight">
          {sel?.crop_ko} 병해충 시기
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-[11px] text-slate-400">
                <th className="w-40 px-5 py-2 text-left font-medium">병해충</th>
                {MONTHS.map((m) => (
                  <th key={m} className={`py-2 text-center font-medium ${m === nowM ? "text-brand-700" : ""}`}>
                    {m}월
                  </th>
                ))}
                <th className="w-24 px-3 py-2 text-right font-medium">오늘</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.map((p) => {
                const s = sum.get(p.pest_id);
                return (
                  <tr key={p.pest_id}>
                    <td className="px-5 py-3">
                      <Link href={`/pests/${p.pest_id}?tab=control`} className="font-semibold text-slate-800 hover:text-brand-700">
                        {p.name_ko}
                      </Link>
                      <div className="text-[11px] text-slate-400">{p.kind === "insect" ? "해충" : "병"}</div>
                    </td>
                    {MONTHS.map((m) => {
                      const on = inSeason(m, p.season.start_month, p.season.end_month);
                      return (
                        <td key={m} className={`px-0.5 py-3 ${m === nowM ? "bg-brand-50/60" : ""}`}>
                          <div className={`h-3 rounded-full ${on ? "bg-brand-500/70" : "bg-slate-100"}`} title={on ? `${m}월 발생·방제 시기` : ""} />
                        </td>
                      );
                    })}
                    <td className="px-3 py-3 text-right">{s && (s.n_applicable ?? 0) > 0 ? <RiskBadge grade={s.max_grade} size="sm" /> : <span className="text-xs text-slate-300">–</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="flex items-start gap-1.5 border-t border-slate-100 px-5 py-3 text-xs leading-relaxed text-slate-500">
          <Icon name="info" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          막대는 병해충별 위험도 계산 시기(문헌·NCPMS 근거의 발생 시기)예요. 이 시기에 예보 이상이 나오면 방제 정보를 확인하세요. 실제 재배 기간 밖은 지도에서 &lsquo;해당 없음&rsquo;으로 빠져요.
        </p>
      </section>
    </div>
  );
}
