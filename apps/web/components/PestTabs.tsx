"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import ModelCard from "./ModelCard";
import RiskBadge from "./RiskBadge";
import SurveyEvalCard from "./SurveyEvalCard";
import TrendChart from "./TrendChart";
import { GradeBar, Icon } from "./ui";
import { GRADES, NA, NA_REASONS, fmtIndex } from "@/lib/grades";
import type { Grade, PestCard, RiskSpotEntry, SpotFile } from "@/lib/types";

const TABS = [
  { id: "now", label: "현재 위험도" },
  { id: "trend", label: "추이" },
  { id: "why", label: "예측 근거" },
  { id: "control", label: "방제 정보" },
  { id: "eval", label: "검증" },
];

export default function PestTabs({
  pest,
  entries,
  spotFile,
  selectedCode,
  initialTab,
  otherPests,
  horizon,
}: {
  pest: PestCard;
  entries: RiskSpotEntry[];
  spotFile: SpotFile | null;
  selectedCode: string;
  initialTab: string;
  otherPests: { pest_id: string; name_ko: string }[];
  horizon: number;
}) {
  const router = useRouter();
  const [tab, setTab] = useState(TABS.some((t) => t.id === initialTab) ? initialTab : "now");
  // 예측 근거 탭: 병해충에 모델이 여러 개면 골라서 카드를 본다
  const models = pest.models ?? [];
  const [whyModelId, setWhyModelId] = useState(pest.default_model ?? models[0]?.model_id ?? "");
  const whyModel = models.find((m) => m.model_id === whyModelId) ?? models[0];
  const series = spotFile?.series[pest.pest_id] ?? [];
  const countMap = Object.fromEntries(GRADES.map((g) => [g.name, entries.filter((e) => e.grade_today === g.name).length])) as Record<Grade, number>;
  const naCount = entries.filter((e) => e.grade_today == null).length;
  const top = entries.filter((e) => e.grade_today != null).slice(0, 10);
  const surveyEvalModels = models.filter((m) => m.eval?.status === "survey_evaluated" && m.eval.test);
  const defaultLabel = models.find((m) => m.is_default)?.label ?? "기본 모델";

  return (
    <div className="card overflow-hidden">
      <div role="tablist" aria-label="상세 정보" className="no-scrollbar flex gap-1 overflow-x-auto overflow-y-hidden border-b border-slate-100 px-3 pt-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            id={`tab-${t.id}`}
            onClick={() => setTab(t.id)}
            className={`relative whitespace-nowrap px-3.5 py-3 text-sm font-medium transition ${tab === t.id ? "text-slate-900" : "text-slate-500 hover:text-slate-800"}`}
          >
            {t.label}
            {tab === t.id && <span aria-hidden="true" className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-brand-600" />}
          </button>
        ))}
      </div>

      <div className="p-5 sm:p-6">
        {tab === "now" && (
          <section role="tabpanel" id="panel-now" aria-labelledby="tab-now" className="space-y-6">
            <div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-end">
              <div>
                <div className="text-xs font-semibold text-slate-500">오늘 지점별 등급 분포</div>
                <div className="mt-3">
                  <GradeBar counts={countMap} naCount={naCount} legend={false} />
                </div>
                <p className="num mt-2 text-xs text-slate-400">
                  지점 {entries.length - naCount}곳{naCount > 0 && ` · ${NA.label} ${naCount}곳`}
                </p>
              </div>
              <ul className="grid grid-cols-4 gap-2 lg:w-[420px]">
                {GRADES.slice()
                  .reverse()
                  .map((g) => (
                    <li key={g.name} className={`rounded-xl px-3 py-2.5 ring-1 ring-inset ${g.bg} ${g.ring}`}>
                      <div className={`text-xs font-semibold ${g.text}`}>
                        <span aria-hidden="true">{g.icon}</span> {g.name}
                      </div>
                      <div className="num mt-0.5 text-xl font-bold text-slate-900">{countMap[g.name]}</div>
                    </li>
                  ))}
              </ul>
            </div>
            {naCount > 0 && (
              <p className="flex items-center gap-1.5 text-xs text-slate-500">
                <Icon name="info" className="h-3.5 w-3.5 text-slate-400" />
                {NA.label} {naCount}곳은 {pest.crop_ko} 비재배지이거나 재배 시기가 아니어서 집계에서 뺐습니다.
              </p>
            )}
            <div>
              <div className="flex items-center justify-between">
                <h3 className="section-title text-sm">위험 상위 지점 · 오늘</h3>
                <Link href={`/map?crop=${pest.crop}&pest=${pest.pest_id}`} className="link-arrow text-xs">
                  지도에서 전체 보기 <Icon name="arrow" className="h-3.5 w-3.5" />
                </Link>
              </div>
              <div className="-mx-3 mt-2 overflow-x-auto">
                <table className="table-clean">
                  <thead>
                    <tr>
                      <th>지점</th>
                      <th>시군</th>
                      <th>등급</th>
                      <th className="text-right">7일 최대</th>
                      <th className="text-right">{horizon}일 최대</th>
                    </tr>
                  </thead>
                  <tbody>
                    {top.map((e) => (
                      <tr key={e.spot_code}>
                        <td>
                          <button
                            className="font-medium text-slate-900 hover:text-brand-700"
                            onClick={() => {
                              router.replace(`/pests/${pest.pest_id}?spot=${e.spot_code}&tab=trend`);
                              setTab("trend");
                            }}
                          >
                            {e.name}
                          </button>
                        </td>
                        <td className="text-slate-500">{e.sigungu}</td>
                        <td>
                          <RiskBadge grade={e.grade_today} index={e.index_today} na={e.na_today} size="sm" />
                        </td>
                        <td className="num text-right text-slate-600">{fmtIndex(e.max_index_7d)}</td>
                        <td className="num text-right text-slate-600">{fmtIndex(e.max_index_10d)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {tab === "trend" && (
          <section role="tabpanel" id="panel-trend" aria-labelledby="tab-trend" className="space-y-4">
            <label className="flex max-w-sm flex-col">
              <span className="field-label">지점</span>
              <select className="field" value={selectedCode} onChange={(e) => router.replace(`/pests/${pest.pest_id}?spot=${e.target.value}&tab=trend`)}>
                {entries.map((e) => (
                  <option key={e.spot_code} value={e.spot_code}>
                    {e.name} ({e.grade_today ? `${e.grade_today} ${fmtIndex(e.index_today)}` : `${NA.label}${e.na_today ? " · " + NA_REASONS[e.na_today].short : ""}`})
                  </option>
                ))}
              </select>
            </label>
            {spotFile ? (
              <TrendChart series={series} weather={spotFile.weather} issuedDate={spotFile.issued_date} cropKo={pest.crop_ko} />
            ) : (
              <p className="text-sm text-slate-500">지점 자료가 없습니다.</p>
            )}
            <p className="text-xs leading-relaxed text-slate-400">
              실선은 관측 기상으로 계산한 값, 점선은 예보·지속성 가정으로 계산한 값입니다. 배경 음영은 주의보(50~)·경보(75~) 구간이고, 회색 빗금은 재배 기간이 아니어서 계산하지 않은 날입니다.
            </p>
          </section>
        )}

        {tab === "why" && (
          <section role="tabpanel" id="panel-why" aria-labelledby="tab-why" className="space-y-5">
            {models.length > 1 && (
              <div>
                <div className="text-xs font-semibold text-slate-500">이 병해충의 예측 모델 {models.length}개 · 예측 지도에서 골라 볼 수 있어요</div>
                <div className="segmented mt-2 flex-wrap" role="radiogroup" aria-label="예측 모델">
                  {models.map((m) => (
                    <button key={m.model_id} role="radio" aria-checked={m.model_id === whyModel?.model_id} onClick={() => setWhyModelId(m.model_id)} className="segmented-item">
                      {m.label}
                      {m.is_default && <span className="ml-1 text-[10px] text-slate-400">기본</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {whyModel?.demo_only && (
              <p className="rounded-xl bg-amber-50 px-4 py-3 text-xs text-amber-800 ring-1 ring-inset ring-amber-200">데모 화면 확인용 가상 모형입니다. 실제 예측에는 쓰지 않습니다.</p>
            )}
            <ModelCard pest={whyModel ? (whyModel as unknown as PestCard) : pest} />
            {models.length > 1 && whyModel && (
              <Link href={`/map?crop=${pest.crop}&pest=${pest.pest_id}${whyModel.is_default ? "" : `&model=${whyModel.model_id}`}`} className="link-arrow text-xs">
                이 모델로 예측 지도 보기 <Icon name="arrow" className="h-3.5 w-3.5" />
              </Link>
            )}
          </section>
        )}

        {tab === "control" && (
          <section role="tabpanel" id="panel-control" aria-labelledby="tab-control" className="space-y-4 text-sm">
            {pest.control ? (
              <dl className="grid gap-3 md:grid-cols-3">
                {[
                  ["발생 환경", pest.control.environment],
                  ["증상·피해", pest.control.symptoms],
                  ["방제 방법", pest.control.control],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-xl border border-slate-100 p-4">
                    <dt className="text-xs font-semibold text-slate-500">{k}</dt>
                    <dd className="mt-1.5 whitespace-pre-line leading-relaxed text-slate-700">{v}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-5 text-slate-600">
                <p className="font-medium text-slate-700">NCPMS 방제 정보 연동 전입니다.</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  모델 카드의 <code>ncpms_key</code>가 채워지면 배치가 자동으로 발생환경·증상·방제법을 가져옵니다.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <a className="btn-secondary btn-sm" href="https://ncpms.rda.go.kr/npms/Main.np" target="_blank" rel="noreferrer">
                    NCPMS 도감에서 {pest.name_ko} 찾기 ↗
                  </a>
                  <a className="btn-secondary btn-sm" href="https://psis.rda.go.kr/" target="_blank" rel="noreferrer">
                    농약안전정보시스템 ↗
                  </a>
                </div>
              </div>
            )}
            <p className="text-xs leading-relaxed text-slate-500">
              권고 방제 시점: 주의보 단계에서 예방 약제를 검토하고, 경보 단계에서는 등록 약제로 적기 방제합니다. 농약은 작물별 등록 약제와 안전사용기준(PLS)을 반드시 확인하세요.
            </p>
            {otherPests.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                같은 작물의 다른 병해충
                {otherPests.map((p) => (
                  <Link key={p.pest_id} href={`/pests/${p.pest_id}`} className="chip hover:bg-slate-200">
                    {p.name_ko}
                  </Link>
                ))}
              </div>
            )}
          </section>
        )}

        {tab === "eval" && (
          <section role="tabpanel" id="panel-eval" aria-labelledby="tab-eval" className="space-y-4 text-sm">
            {surveyEvalModels.map((m) => (
              <SurveyEvalCard key={m.model_id} model={m} defaultLabel={defaultLabel} />
            ))}
            {surveyEvalModels.length > 0 && <div className="pt-2 text-xs font-semibold text-slate-500">기본 모델({defaultLabel}) 백테스트</div>}
            {pest.eval.status === "evaluated" && pest.eval.years ? (
              <div className="-mx-3 overflow-x-auto">
                <table className="table-clean">
                  <thead>
                    <tr>
                      <th>연도</th>
                      <th className="text-right">관측 수</th>
                      <th className="text-right">적중률</th>
                      <th className="text-right">정밀도</th>
                      <th className="text-right">재현율</th>
                      <th className="text-right">평균 리드타임(일)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(pest.eval.years).map(([y, v]) => (
                      <tr key={y} className="num">
                        <td className="font-medium">{y}</td>
                        <td className="text-right">{v.n_obs}</td>
                        <td className="text-right">{v.hit_rate ?? "-"}</td>
                        <td className="text-right">{v.precision ?? "-"}</td>
                        <td className="text-right">{v.recall ?? "-"}</td>
                        <td className="text-right">{v.mean_lead_days ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex gap-3 rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-5">
                <Icon name="chart" className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" />
                <div>
                  <p className="font-medium text-slate-700">아직 검증되지 않은 모델입니다.</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500">{pest.eval.note ?? "예찰조사(2015~2025) 적재 후 pipeline/backtest.py 가 연도별 적중률·정밀도·재현율·리드타임을 계산합니다."}</p>
                </div>
              </div>
            )}
            <p className="text-xs leading-relaxed text-slate-400">적중률은 예찰 &lsquo;발생&rsquo; 기록 7일 전부터 당일 사이에 주의보 이상을 냈는지로 계산합니다. 모델 버전이 바뀔 때마다 다시 계산됩니다.</p>
          </section>
        )}
      </div>
    </div>
  );
}
