import Link from "next/link";
import { Icon } from "./ui";
import { fmtDate, fmtMD } from "@/lib/format";
import { nextSeasons, overwinter, seasonRecaps, type SeasonRecap } from "@/lib/home";
import type { PestCard } from "@/lib/types";

const pct = (v: number) => `${Math.round(v * 100)}%`;
const shortSgg = (s: string) => s.split(" ").slice(1).join(" ") || s;

/** 시즌 돌아보기: 병해충별 지난 시즌 실제 NCPMS 예찰(평년 비교·심했던 곳·겨울나기). 과거 발생 현황 화면 위쪽 */
export async function SeasonRecapSection({ pests }: { pests: PestCard[] }) {
  const recaps = (await seasonRecaps(pests)).sort((a, b) => b.sggOcc - a.sggOcc);
  if (!recaps.length) return null;
  const winter = Object.fromEntries(await Promise.all(recaps.map(async (r) => [r.pest_id, await overwinter(r.pest_id)] as const)));
  const latest = Math.max(...recaps.map((x) => x.year));
  return (
    <section aria-labelledby="recap" className="space-y-3">
      <div>
        <h2 id="recap" className="section-title text-lg">
          {latest} 시즌 돌아보기
        </h2>
        <p className="mt-0.5 text-xs text-slate-500">NCPMS 국가 예찰의 시군별 실제 조사값이에요. 평년은 그 전 해들의 평균이에요. 카드의 &lsquo;시군별 지도&rsquo;를 누르면 아래 지도에서 바로 볼 수 있어요.</p>
      </div>
      <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {recaps.map((r) => (
          <RecapCard key={r.pest_id} r={r} winter={winter[r.pest_id] ?? null} latest={latest} />
        ))}
      </ul>
    </section>
  );
}

/** 다음 시즌 일정: 작물별 위험도 계산 시작일과 D-day(모델 카드 season.start_month). 방제 일정 화면 위쪽 */
export function NextSeasonCard({ pests, today }: { pests: PestCard[]; today: string }) {
  const next = nextSeasons(pests, today);
  if (!next.length) return null;
  return (
    <section aria-labelledby="next" className="card overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-5 py-3">
        <h2 id="next" className="text-base font-bold tracking-tight">
          다음 시즌 일정
        </h2>
        <p className="text-xs text-slate-400">병해충 모델이 위험도를 계산하기 시작하는 날(지역 재배 기간에 따라 더 늦을 수 있어요)</p>
      </div>
      <ul className="grid divide-y divide-slate-100 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {next.map((n) => (
          <li key={n.crop} className="px-5 py-4">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-lg font-bold tracking-tight text-slate-900">{n.crop_ko}</span>
              <span className="num rounded-md bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">D-{n.dday}</span>
            </div>
            <div className="num mt-0.5 text-sm text-slate-600">{fmtDate(n.start)}부터</div>
            <div className="mt-1 truncate text-xs text-slate-400">{n.pests.join(" · ")}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RecapCard({ r, winter, latest }: { r: SeasonRecap; winter: string | null; latest: number }) {
  const tone = r.vsNormal === "높음" ? "bg-amber-50 text-amber-800 ring-amber-200" : r.vsNormal === "낮음" ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-slate-100 text-slate-600 ring-slate-200";
  const maxV = Math.max(...r.history.map((h) => h.v), 0.01);
  return (
    <li className="card flex flex-col overflow-hidden">
      <div className="flex items-start justify-between gap-3 px-5 pt-4">
        <div className="min-w-0">
          <p className="text-xs text-slate-400">
            {r.crop_ko}
            {r.year < latest && <span className="num text-amber-700"> · 최근 자료 {r.year}년</span>}
          </p>
          <h3 className="truncate text-lg font-bold tracking-tight text-slate-900">{r.name_ko.replace(r.crop_ko, "").trim() || r.name_ko}</h3>
        </div>
        {r.vsNormal && <span className={`chip shrink-0 ring-1 ring-inset ${tone}`}>평년보다 {r.vsNormal === "비슷" ? "비슷" : r.vsNormal}</span>}
      </div>

      <div className="flex items-end justify-between gap-4 px-5 pt-3">
        <div>
          <div className="num text-3xl font-bold tracking-tight text-slate-900">{pct(r.sggOcc)}</div>
          <div className="text-xs text-slate-500">
            조사 시군 중 발생{r.normal != null && <span className="num text-slate-400"> · 평년 {pct(r.normal)}</span>}
          </div>
        </div>
        {/* 연도별 발생 시군 비율(마지막 해 강조) */}
        <svg viewBox={`0 0 ${r.history.length * 9} 40`} className="h-10 w-32 shrink-0" role="img" aria-label={`연도별 발생 시군 비율 ${r.history[0].year}~${r.year}`}>
          {r.history.map((h, k) => {
            const hh = Math.max(1.5, (h.v / maxV) * 38);
            return <rect key={h.year} x={k * 9 + 1} y={40 - hh} width={6} height={hh} rx={1.5} fill={k === r.history.length - 1 ? "#0f766e" : "#cbd5e1"} />;
          })}
        </svg>
      </div>

      <dl className="mt-3 space-y-1.5 px-5 text-xs">
        <div className="flex gap-2">
          <dt className="w-16 shrink-0 text-slate-400">심했던 곳</dt>
          <dd className="num text-slate-700">{r.top.map((t) => `${shortSgg(t.sigungu)} ${t.max}%`).join(" · ")}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-16 shrink-0 text-slate-400">가장 많던 때</dt>
          <dd className="num text-slate-700">{fmtMD(r.peak)} 조사</dd>
        </div>
      </dl>

      {winter && (
        <div className="mx-5 mt-3 rounded-xl bg-slate-50 px-3 py-2.5 text-xs leading-relaxed text-slate-600">
          <span className="font-semibold text-slate-700">겨울나기 </span>
          {winter}
          <span className="text-slate-400"> (NCPMS)</span>
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-slate-100 px-5 py-3 pt-3 text-xs">
        <Link href={`/survey?pest=${r.pest_id}#explorer`} className="link-arrow">
          시군별 지도 <Icon name="arrow" className="h-3.5 w-3.5" />
        </Link>
        <Link href={`/pests/${r.pest_id}?tab=control`} className="text-slate-500 hover:text-slate-800">
          방제 요령
        </Link>
      </div>
    </li>
  );
}
