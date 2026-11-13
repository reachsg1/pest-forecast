import type { Metadata } from "next";
import { promises as fs } from "fs";
import path from "path";
import SurveyExplorer from "@/components/SurveyExplorer";
import { PageHeader } from "@/components/ui";
import { getPests } from "@/lib/data";

export const metadata: Metadata = { title: "과거 발생 현황" };

/** NCPMS 예찰(실제 조사값)을 병해충·연도·조사일별로 지도와 표로 본다. 자료가 있는 병해충만 고를 수 있다 */
export default async function SurveyPage({ searchParams }: { searchParams: Promise<{ pest?: string }> }) {
  const { pest } = await searchParams;
  const pests = await getPests();
  const dir = path.join(process.cwd(), "public", "data", "surveyview");
  const have = new Set((await fs.readdir(dir).catch(() => [] as string[])).map((f) => f.replace(/\.json$/, "")));
  const list = pests.filter((p) => have.has(p.pest_id)).map((p) => ({ pest_id: p.pest_id, name_ko: p.name_ko, crop_ko: p.crop_ko }));
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="NCPMS 예찰" title="과거 발생 현황" desc="국가 예찰(NCPMS)에서 조사한 시군별 실제 발생을 날짜별로 지도와 표로 봅니다." />
      {list.length ? <SurveyExplorer pests={list} initial={list.some((p) => p.pest_id === pest) ? pest : undefined} /> : <p className="card p-5 text-sm text-slate-500">아직 공개할 예찰 자료가 없어요.</p>}
    </div>
  );
}
