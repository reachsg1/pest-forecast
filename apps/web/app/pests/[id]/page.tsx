import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ROLE_HEADER } from "@/lib/auth";
import type { Metadata } from "next";
import PestTabs from "@/components/PestTabs";
import RiskBadge from "@/components/RiskBadge";
import { getPest, getPests, getRisk, getSpotFile } from "@/lib/data";
import { gradeRank, pestFullName } from "@/lib/grades";
import type { Grade } from "@/lib/types";
import { fmtDate } from "@/lib/format";

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
  // 서비스 제외 병해충(예찰 검증 기준 미달)은 관리자만 상세를 본다
  const role = (await headers()).get(ROLE_HEADER) ?? "";
  if (!pest || (pest.service?.listed === false && role !== "admin")) notFound();
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
      <header className="card">
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-8 sm:py-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              {[pest.crop_ko, pest.kind === "insect" ? "해충" : "병", `유형 ${pest.type}`].map((t) => (
                <span key={t} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                  {t}
                </span>
              ))}
            </div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{pestFullName(pest.crop_ko, pest.name_ko)}</h1>
            <p className="mt-1 text-xs text-slate-500 sm:text-sm">
              <span className="italic">{pest.name_sci}</span>
              <span className="mx-1.5 text-slate-300">·</span>
              <a className="font-medium text-brand-700 hover:text-brand-900" href={ncpmsUrl} target="_blank" rel="noreferrer">
                NCPMS 도감 ↗
              </a>
            </p>
          </div>
          <div className="flex shrink-0 gap-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5">
              <div className="text-[11px] text-slate-500">오늘 전국 최고 등급</div>
              <div className="mt-1">
                <RiskBadge grade={maxGrade} />
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5">
              <div className="text-[11px] text-slate-500">주의보 이상</div>
              <div className="num mt-0.5 text-2xl font-bold tracking-tight text-slate-900">
                {alertN}
                <span className="text-sm font-medium text-slate-400"> / {applicable.length}곳</span>
              </div>
            </div>
          </div>
          <p className="num w-full text-xs text-slate-400">
            기준일 {fmtDate(risk?.issued_date)}
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
