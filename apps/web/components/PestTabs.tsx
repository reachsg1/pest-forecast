"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import ModelCard from "./ModelCard";
import RiskBadge from "./RiskBadge";
import TrendChart from "./TrendChart";
import { GRADES, NA, NA_REASONS, fmtIndex } from "@/lib/grades";
import type { PestCard, RiskSpotEntry, SpotFile } from "@/lib/types";

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
  const series = spotFile?.series[pest.pest_id] ?? [];
  const counts = GRADES.map((g) => ({ ...g, n: entries.filter((e) => e.grade_today === g.name).length }));
  const naCount = entries.filter((e) => e.grade_today == null).length;

  return (
    <div className="rounded-lg border bg-white">
      <div role="tablist" aria-label="상세 정보" className="flex overflow-x-auto border-b">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            id={`tab-${t.id}`}
            onClick={() => setTab(t.id)}
            className={`whitespace-nowrap px-4 py-3 text-sm font-medium ${tab === t.id ? "border-b-2 border-brand text-brand-dark" : "text-gray-600 hover:text-gray-900"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="p-4">
        {tab === "now" && (
          <section role="tabpanel" id="panel-now" aria-labelledby="tab-now" className="space-y-4">
            <ul className="grid grid-cols-4 gap-2">
              {counts
                .slice()
                .reverse()
                .map((g) => (
                  <li key={g.name} className={`rounded p-3 text-center ${g.bg}`}>
                    <div className={`text-xs font-semibold ${g.text}`}>{g.name}</div>
                    <div className="text-2xl font-bold">{g.n}</div>
                  </li>
                ))}
            </ul>
            {naCount > 0 && (
              <p className="text-xs text-gray-500">
                {NA.label} {naCount}곳은 {pest.crop_ko} 비재배지이거나 재배 시기가 아니어서 위 집계에서 뺐습니다.
              </p>
            )}
            <div>
              <h3 className="text-sm font-semibold">위험 상위 지점 (오늘)</h3>
              <table className="mt-1 w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-gray-600">
                    <th className="py-1">지점</th>
                    <th className="py-1">시군</th>
                    <th className="py-1">등급</th>
                    <th className="py-1">7일 최대</th>
                    <th className="py-1">{horizon}일 최대</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.filter((e) => e.grade_today != null).slice(0, 10).map((e) => (
                    <tr key={e.spot_code} className="border-b">
                      <td className="py-1">
                        <button className="underline" onClick={() => { router.replace(`/pests/${pest.pest_id}?spot=${e.spot_code}&tab=trend`); setTab("trend"); }}>
                          {e.name}
                        </button>
                      </td>
                      <td className="py-1 text-gray-600">{e.sigungu}</td>
                      <td className="py-1">
                        <RiskBadge grade={e.grade_today} index={e.index_today} na={e.na_today} size="sm" />
                      </td>
                      <td className="py-1 tabular-nums">{fmtIndex(e.max_index_7d)}</td>
                      <td className="py-1 tabular-nums">{fmtIndex(e.max_index_10d)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Link href={`/map?crop=${pest.crop}&pest=${pest.pest_id}`} className="mt-2 inline-block text-sm underline">
                지도에서 전체 보기
              </Link>
            </div>
          </section>
        )}

        {tab === "trend" && (
          <section role="tabpanel" id="panel-trend" aria-labelledby="tab-trend" className="space-y-3">
            <label className="flex items-center gap-2 text-sm">
              <span className="text-gray-600">지점</span>
              <select
                className="rounded border px-2 py-1"
                value={selectedCode}
                onChange={(e) => router.replace(`/pests/${pest.pest_id}?spot=${e.target.value}&tab=trend`)}
              >
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
              <p className="text-sm text-gray-500">지점 자료가 없습니다.</p>
            )}
            <p className="text-xs text-gray-500">
              실선은 관측 기상으로 계산한 값, 점선은 예보·지속성 가정으로 계산한 값입니다. 배경 음영은 주의보(50~)·경보(75~) 구간이고, 회색 빗금은 재배 기간이 아니어서 계산하지 않은 날입니다.
            </p>
          </section>
        )}

        {tab === "why" && (
          <section role="tabpanel" id="panel-why" aria-labelledby="tab-why">
            <ModelCard pest={pest} />
          </section>
        )}

        {tab === "control" && (
          <section role="tabpanel" id="panel-control" aria-labelledby="tab-control" className="space-y-3 text-sm">
            {pest.control ? (
              <dl className="space-y-2">
                <dt className="font-semibold">발생 환경</dt>
                <dd className="whitespace-pre-line text-gray-700">{pest.control.environment}</dd>
                <dt className="font-semibold">증상·피해</dt>
                <dd className="whitespace-pre-line text-gray-700">{pest.control.symptoms}</dd>
                <dt className="font-semibold">방제 방법</dt>
                <dd className="whitespace-pre-line text-gray-700">{pest.control.control}</dd>
              </dl>
            ) : (
              <div className="rounded border border-dashed p-4 text-gray-600">
                <p>NCPMS 방제 정보 연동 전입니다. 모델 카드의 <code>ncpms_key</code>가 채워지면 배치가 자동으로 발생환경·증상·방제법을 가져옵니다.</p>
                <ul className="mt-2 list-disc pl-5">
                  <li>
                    <a className="underline" href="https://ncpms.rda.go.kr/npms/Main.np" target="_blank" rel="noreferrer">
                      NCPMS 병해충 도감에서 {pest.name_ko} 찾기 ↗
                    </a>
                  </li>
                  <li>
                    <a className="underline" href="https://psis.rda.go.kr/" target="_blank" rel="noreferrer">
                      농약안전정보시스템(등록 약제 검색) ↗
                    </a>
                  </li>
                </ul>
              </div>
            )}
            <p className="text-xs text-gray-500">
              권고 방제 시점: 주의보 단계에서 예방 약제를 검토하고, 경보 단계에서는 등록 약제로 적기 방제합니다. 농약은 작물별 등록 약제와 안전사용기준(PLS)을 반드시 확인하세요.
            </p>
            {otherPests.length > 0 && (
              <p className="text-xs text-gray-600">
                같은 작물의 다른 병해충:{" "}
                {otherPests.map((p, i) => (
                  <span key={p.pest_id}>
                    {i > 0 && " · "}
                    <Link href={`/pests/${p.pest_id}`} className="underline">
                      {p.name_ko}
                    </Link>
                  </span>
                ))}
              </p>
            )}
          </section>
        )}

        {tab === "eval" && (
          <section role="tabpanel" id="panel-eval" aria-labelledby="tab-eval" className="space-y-3 text-sm">
            {pest.eval.status === "evaluated" && pest.eval.years ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-gray-600">
                    <th className="py-1">연도</th>
                    <th className="py-1">관측 수</th>
                    <th className="py-1">적중률</th>
                    <th className="py-1">정밀도</th>
                    <th className="py-1">재현율</th>
                    <th className="py-1">평균 리드타임(일)</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(pest.eval.years).map(([y, v]) => (
                    <tr key={y} className="border-b tabular-nums">
                      <td className="py-1">{y}</td>
                      <td className="py-1">{v.n_obs}</td>
                      <td className="py-1">{v.hit_rate ?? "-"}</td>
                      <td className="py-1">{v.precision ?? "-"}</td>
                      <td className="py-1">{v.recall ?? "-"}</td>
                      <td className="py-1">{v.mean_lead_days ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="rounded border border-dashed p-4 text-gray-600">
                <p className="font-semibold">아직 검증되지 않은 모델입니다.</p>
                <p className="mt-1">{pest.eval.note ?? "예찰조사(2015~2025) 적재 후 pipeline/backtest.py 가 연도별 적중률·정밀도·재현율·리드타임을 계산합니다."}</p>
              </div>
            )}
            <p className="text-xs text-gray-500">
              적중률은 예찰 '발생' 기록 7일 전부터 당일 사이에 주의보 이상을 냈는지로 계산합니다. 모델 버전이 바뀔 때마다 다시 계산됩니다.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
