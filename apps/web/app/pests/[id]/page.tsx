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

  return (
    <div className="space-y-4">
      <nav aria-label="경로" className="text-xs text-gray-500">
        <Link href="/pests" className="hover:underline">
          병해충
        </Link>{" "}
        › {pest.crop_ko} › {pest.name_ko}
      </nav>
      <header className="flex flex-wrap items-start justify-between gap-3 rounded-lg border bg-white p-4">
        <div>
          <h1 className="text-2xl font-bold">
            {pestFullName(pest.crop_ko, pest.name_ko)}
          </h1>
          <p className="text-sm text-gray-600">
            <span className="italic">{pest.name_sci}</span> · 기주: {pest.crop_ko} ·{" "}
            <a className="underline" href={ncpmsUrl} target="_blank" rel="noreferrer">
              NCPMS 도감 ↗
            </a>
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs text-gray-600">오늘 전국 최고 등급 · 기준일 {risk?.issued_date ?? "-"}</div>
          <RiskBadge grade={maxGrade} size="lg" />
          <div className="mt-1 text-xs text-gray-600">
            주의보 이상 {applicable.filter((e) => gradeRank(e.grade_today) >= 2).length}곳 / {applicable.length}곳
            {entries.length > applicable.length && <span className="text-gray-400"> · 해당 없음 {entries.length - applicable.length}곳</span>}
          </div>
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
