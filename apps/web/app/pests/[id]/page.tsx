import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import PestTabs from "@/components/PestTabs";
import RiskBadge from "@/components/RiskBadge";
import { getPest, getPests, getRisk, getSpotFile } from "@/lib/data";
import { gradeRank, pestFullName } from "@/lib/grades";
import type { Grade } from "@/lib/types";

type Params = Promise<{ id: string }>;
type Search = Promise<{ spot?: string; tab?: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const pest = await getPest(id);
  return { title: pest ? `${pest.name_ko} 발생 예측` : "병해충" };
}

export default async function PestDetailPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { id } = await params;
  const { spot, tab } = await searchParams;
  const [pest, risk, pests] = await Promise.all([getPest(id), getRisk(id), getPests()]);
  if (!pest) notFound();
  const entries = risk?.spots ?? [];
  // '해당 없음' 지점은 등급 비교·집계에서 뺀다
  const applicable = entries.filter((e) => e.grade_today != null);
  const maxGrade = applicable.reduce<Grade | null>((g, e) => (gradeRank(e.grade_today) > gradeRank(g) ? e.grade_today : g), null);
  const selectedCode = spot && entries.some((e) => e.spot_code === spot) ? spot : entries[0]?.spot_code ?? "";
  const spotFile = selectedCode ? await getSpotFile(selectedCode) : null;
  const ncpmsUrl = "https://ncpms.rda.go.kr/npms/Main.np";

  const alertN = applicable.filter((e) => gradeRank(e.grade_today) >= 2).length;

  return (
    <div className="space-y-6">
      <nav aria-label="경로" className="flex items-center gap-1.5 text-xs text-slate-400">
        <Link href="/pests" className="hover:text-slate-700">
          병해충
        </Link>
        <span>/</span>
        <span>{pest.crop_ko}</span>
        <span>/</span>
        <span className="text-slate-600">{pest.name_ko}</span>
      </nav>
      <header className="hero-dark">
        <div className="relative flex flex-wrap items-end justify-between gap-6 px-6 py-8 sm:px-10 sm:py-10">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              {[pest.crop_ko, pest.kind === "insect" ? "해충" : "병", `유형 ${pest.type}`].map((t) => (
                <span key={t} className="rounded-full border border-white/15 bg-white/10 px-2.5 py-0.5 text-xs font-medium text-emerald-100">
                  {t}
                </span>
              ))}
            </div>
            <h1 className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-4xl">{pestFullName(pest.crop_ko, pest.name_ko)}</h1>
            <p className="mt-2 text-sm text-white/60">
              <span className="italic">{pest.name_sci}</span>
              <span className="mx-1.5 text-white/30">·</span>
              <a className="font-medium text-emerald-300 hover:text-emerald-200" href={ncpmsUrl} target="_blank" rel="noreferrer">
                NCPMS 도감 ↗
              </a>
            </p>
          </div>
          <div className="flex shrink-0 gap-3">
            <div className="glass-tile px-5 py-4">
              <div className="text-xs text-white/55">오늘 전국 최고 등급</div>
              <div className="mt-2">
                <RiskBadge grade={maxGrade} size="lg" />
              </div>
            </div>
            <div className="glass-tile px-5 py-4">
              <div className="text-xs text-white/55">주의보 이상</div>
              <div className="num mt-1.5 text-3xl font-bold tracking-tight text-white">
                {alertN}
                <span className="text-sm font-medium text-white/50"> / {applicable.length}곳</span>
              </div>
            </div>
          </div>
          <p className="num w-full text-xs text-white/40">
            기준일 {risk?.issued_date ?? "-"}
            {entries.length > applicable.length && ` · 해당 없음 ${entries.length - applicable.length}곳 제외`}
          </p>
        </div>
      </header>
      <PestTabs
        pest={pest}
        entries={entries}
        spotFile={spotFile}
        selectedCode={selectedCode}
        initialTab={tab ?? "now"}
        otherPests={pests.filter((p) => p.crop === pest.crop && p.pest_id !== pest.pest_id).map((p) => ({ pest_id: p.pest_id, name_ko: p.name_ko }))}
        horizon={risk?.horizon_days ?? 10}
      />
    </div>
  );
}
