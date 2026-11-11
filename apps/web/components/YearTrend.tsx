"use client";

import { useEffect, useMemo, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Icon } from "./ui";
import { fmtMD } from "@/lib/format";

type TrendRound = { date: string; n: number; mean: number; occ_rate: number; max: number };
type TrendYear = {
  year: number;
  n_records: number;
  n_rounds: number;
  n_sigungu: number;
  mean: number;
  occ_rate: number;
  sgg_occ_rate: number;
  max: number;
  peak_date: string;
  top_sigungu: { sigungu: string; max: number }[];
  rounds: TrendRound[];
};
type TrendFile = { pest_id: string; source: string; item: string; unit: string; occurrence: string; years: TrendYear[] };

const pct = (v: number) => `${Math.round(v * 100)}%`;
const BRAND = "#1f6f4a";

/** 받침이 있으면 "이", 없으면 "가" */
function iga(word: string) {
  const c = word.charCodeAt(word.length - 1) - 0xac00;
  return c >= 0 && c <= 11171 && c % 28 !== 0 ? "이" : "가";
}

/** 병해충별 연도별 발생 추이(NCPMS 시군 예찰). */
export default function YearTrend({ pestId, nameKo }: { pestId: string; nameKo: string }) {
  const [file, setFile] = useState<TrendFile | null | undefined>(undefined);
  const [year, setYear] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/data/trend/${pestId}.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: TrendFile | null) => {
        if (!alive) return;
        setFile(d);
        if (d?.years.length) setYear(d.years[d.years.length - 1].year);
      })
      .catch(() => alive && setFile(null));
    return () => {
      alive = false;
    };
  }, [pestId]);

  // 시기별 곡선: 같은 조사 시기(월·일)끼리 모든 연도 평균
  const seasonal = useMemo(() => {
    if (!file || year == null) return [];
    const acc = new Map<string, number[]>();
    file.years.forEach((y) => y.rounds.forEach((r) => acc.set(r.date.slice(5), [...(acc.get(r.date.slice(5)) ?? []), r.occ_rate])));
    const sel = new Map((file.years.find((y) => y.year === year)?.rounds ?? []).map((r) => [r.date.slice(5), r]));
    return Array.from(acc.entries())
      .filter(([, v]) => v.length >= 2)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([md, v]) => ({
        md: fmtMD(md),
        avg: Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100),
        sel: sel.has(md) ? Math.round(sel.get(md)!.occ_rate * 100) : null,
      }));
  }, [file, year]);

  if (file === undefined) return <p className="py-6 text-center text-xs text-slate-400">연도별 예찰 자료를 불러오는 중…</p>;
  if (file === null || !file.years.length)
    return (
      <div className="flex gap-3 rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-5">
        <Icon name="chart" className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" />
        <div>
          <p className="font-medium text-slate-700">아직 이 병해충의 연도별 예찰 자료를 받지 못했어요.</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">NCPMS 시군 예찰 조사값을 차례로 받는 중입니다(일일 호출 한도 때문에 작물별로 나눠 받음).</p>
        </div>
      </div>
    );

  const ys = file.years;
  const uname = file.unit.replace("(%)", "");
  const last = ys[ys.length - 1];
  const avgSgg = ys.reduce((a, y) => a + y.sgg_occ_rate, 0) / ys.length;
  const worst = ys.reduce((m, y) => (y.mean > m.mean ? y : m), ys[0]);
  const chart = ys.map((y) => ({ year: String(y.year), sgg: Math.round(y.sgg_occ_rate * 100), occ: Math.round(y.occ_rate * 100), mean: y.mean }));
  const diff = last.sgg_occ_rate - avgSgg;
  const sel = ys.find((y) => y.year === year) ?? last;

  return (
    <div className="space-y-5">
      <div>
        <h3 className="section-title">연도별 발생 추이</h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          {file.source} · 항목 {file.item} · 발생 = {file.occurrence}
        </p>
      </div>

      {/* 한 줄 요약 */}
      <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4 text-sm leading-relaxed text-slate-700">
        {last.year}년에는 조사 시군의 <b className="num text-slate-900">{pct(last.sgg_occ_rate)}</b>에서 한 번 이상 {nameKo}{iga(nameKo)} 발생했어요.{" "}
        {ys.length > 1 && (
          <>
            {ys[0].year}~{last.year}년 평균({pct(avgSgg)})보다 <b>{Math.abs(diff) < 0.03 ? "비슷한 수준" : diff > 0 ? `${pct(diff)}p 많았어요` : `${pct(-diff)}p 적었어요`}</b>
            {Math.abs(diff) < 0.03 ? "이에요" : ""}. 가장 심했던 해는{" "}
            <b className="num">
              {worst.year}년(평균 {uname} {worst.mean.toFixed(2)}%)
            </b>
            이에요.
          </>
        )}
      </div>

      {/* 연도별 차트 */}
      <div>
        <div className="mb-1 text-xs font-semibold text-slate-500">연도별 · 막대 = 발생 시군 비율(%), 선 = 평균 {file.unit}</div>
        <div className="h-64 w-full">
          <ResponsiveContainer>
            <ComposedChart data={chart} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid stroke="#eef2f7" vertical={false} />
              <XAxis dataKey="year" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="l" domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
              <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11 }} />
              <Tooltip
                formatter={(v: unknown, name: unknown) => [String(name).includes("평균") ? String(v) : `${v}%`, String(name)]}
                labelFormatter={(l: unknown) => `${String(l)}년`}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar yAxisId="l" dataKey="sgg" name="발생 시군 비율" fill="#a7d3bd" radius={[4, 4, 0, 0]} />
              <Line yAxisId="r" type="monotone" dataKey="mean" name={`평균 ${file.unit}`} stroke={BRAND} strokeWidth={2.5} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 시기별 곡선 */}
      <div>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold text-slate-500">조사 시기별 발생 비율 · 선택한 해와 전체 평균</span>
          <select className="field py-1 text-xs" value={sel.year} onChange={(e) => setYear(Number(e.target.value))} aria-label="비교할 연도">
            {ys
              .slice()
              .reverse()
              .map((y) => (
                <option key={y.year} value={y.year}>
                  {y.year}년
                </option>
              ))}
          </select>
        </div>
        <div className="h-56 w-full">
          <ResponsiveContainer>
            <LineChart data={seasonal} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid stroke="#eef2f7" vertical={false} />
              <XAxis dataKey="md" tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
              <Tooltip formatter={(v: unknown, name: unknown) => [`${v}%`, String(name)]} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="avg" name={`${ys[0].year}~${last.year}년 평균`} stroke="#94a3b8" strokeDasharray="4 3" dot={false} />
              <Line type="monotone" dataKey="sel" name={`${sel.year}년`} stroke={BRAND} strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-1 text-xs text-slate-400">
          {sel.year}년 정점 {fmtMD(sel.peak_date)} · 많이 발생한 시군 {sel.top_sigungu.length ? sel.top_sigungu.slice(0, 3).map((t) => `${t.sigungu} ${t.max}%`).join(", ") : "없음"}
        </p>
      </div>

      {/* 표 */}
      <div className="-mx-3 overflow-x-auto">
        <table className="table-clean">
          <thead>
            <tr>
              <th>연도</th>
              <th className="text-right">조사 시군</th>
              <th className="text-right">회차</th>
              <th className="text-right">발생 시군 비율</th>
              <th className="text-right">평균 {file.unit}</th>
              <th className="hidden text-right sm:table-cell">최대</th>
              <th className="hidden sm:table-cell">정점 시기</th>
            </tr>
          </thead>
          <tbody>
            {ys
              .slice()
              .reverse()
              .map((y) => (
                <tr key={y.year} className="num">
                  <td className="font-medium">{y.year}</td>
                  <td className="text-right">{y.n_sigungu}</td>
                  <td className="text-right">{y.n_rounds}</td>
                  <td className="text-right">{pct(y.sgg_occ_rate)}</td>
                  <td className="text-right">{y.mean}</td>
                  <td className="hidden text-right sm:table-cell">{y.max}</td>
                  <td className="hidden sm:table-cell">{fmtMD(y.peak_date)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs leading-relaxed text-slate-400">조사 시군·회차 수가 해마다 달라 연도 간 비교는 대략적인 경향으로 보세요. 발생 시군 비율은 그해 한 번이라도 조사값이 0보다 컸던 시군의 비율입니다.</p>
    </div>
  );
}
