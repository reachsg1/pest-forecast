"use client";

import { useMemo } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { GRADES, NA, NA_REASONS, fmtIndex } from "@/lib/grades";
import type { NaReason, SeriesPoint, WeatherDay } from "@/lib/types";
import { fmtMD } from "@/lib/format";

export default function TrendChart({ series, weather, issuedDate, cropKo = "작물" }: { series: SeriesPoint[]; weather: WeatherDay[]; issuedDate: string; cropKo?: string }) {
  const data = useMemo(() => {
    const wx = new Map(weather.map((w) => [w.date, w]));
    return series.map((p) => {
      const w = wx.get(p.date);
      return {
        date: fmtMD(p.date),
        full: p.date,
        past: p.is_forecast ? null : p.index,
        forecast: p.is_forecast || p.offset === 0 ? p.index : null,
        rain: w?.rain ?? 0,
        tavg: w?.tavg ?? null,
        grade: p.grade,
        na: (p.na_reason ?? null) as NaReason | null,
      };
    });
  }, [series, weather]);

  // 해당 없음(재배 기간 아님 등)이 이어지는 구간 → 빗금 영역
  const naRanges = useMemo(() => {
    const out: { x1: string; x2: string }[] = [];
    let start: string | null = null;
    data.forEach((d, i) => {
      if (d.na && start == null) start = d.date;
      const endsHere = d.na && (i === data.length - 1 || !data[i + 1].na);
      if (endsHere && start != null) {
        out.push({ x1: start, x2: d.date });
        start = null;
      }
    });
    return out;
  }, [data]);

  if (!data.length) return <p className="text-sm text-gray-500">추이 자료가 없습니다.</p>;

  // 전 기간이 비재배지면 빈 차트 대신 이유를 보여준다
  if (data.every((d) => d.na === "not_grown")) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 px-4 py-10 text-center">
        <div className="text-2xl text-gray-300" aria-hidden="true">
          {NA.icon}
        </div>
        <p className="mt-1 text-sm font-medium text-gray-600">{NA_REASONS.not_grown.long(cropKo)}</p>
        <p className="mt-1 text-xs text-gray-400">재배 현황 자료(시군별 재배면적)를 기준으로 판단했습니다.</p>
      </div>
    );
  }

  const todayLabel = fmtMD(issuedDate);

  return (
    <div className="space-y-2">
      <div className="h-72 w-full">
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <defs>
              <pattern id="na-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="6" height="6" fill="#f8fafc" />
                <line x1="0" y1="0" x2="0" y2="6" stroke={NA.stroke} strokeWidth="1.2" strokeOpacity="0.55" />
              </pattern>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} interval={4} />
            <YAxis yAxisId="risk" domain={[0, 100]} tick={{ fontSize: 11 }} width={32} />
            <YAxis yAxisId="wx" orientation="right" tick={{ fontSize: 11 }} width={36} />
            <ReferenceArea yAxisId="risk" y1={75} y2={100} fill={GRADES[3].color} fillOpacity={0.06} />
            <ReferenceArea yAxisId="risk" y1={50} y2={75} fill={GRADES[2].color} fillOpacity={0.06} />
            {naRanges.map((r) => (
              <ReferenceArea
                key={r.x1}
                yAxisId="risk"
                x1={r.x1}
                x2={r.x2}
                y1={0}
                y2={100}
                fill="url(#na-hatch)"
                fillOpacity={1}
                stroke="none"
                ifOverflow="extendDomain"
                label={{ value: "재배 기간 아님", position: "insideTop", fontSize: 11, fill: "#64748b" }}
              />
            ))}
            <ReferenceLine yAxisId="risk" x={todayLabel} stroke="#555" strokeDasharray="4 4" label={{ value: "오늘", position: "insideTopRight", fontSize: 11 }} />
            <Bar yAxisId="wx" dataKey="rain" name="일강우(mm)" fill="#7fb3d5" barSize={6} />
            <Line yAxisId="wx" type="monotone" dataKey="tavg" name="평균기온(℃)" stroke="#999" dot={false} strokeWidth={1} />
            <Line yAxisId="risk" type="monotone" dataKey="past" name="위험지수(관측)" stroke="#1f6f4a" strokeWidth={2.5} dot={false} connectNulls={false} />
            <Line yAxisId="risk" type="monotone" dataKey="forecast" name="위험지수(예측)" stroke="#1f6f4a" strokeWidth={2.5} strokeDasharray="5 4" dot={false} connectNulls={false} />
            <Tooltip
              formatter={(v: unknown, name: unknown) => [typeof v === "number" ? v.toFixed(1) : String(v ?? ""), String(name)]}
              labelFormatter={(l: unknown) => {
                const d = data.find((x) => x.date === l);
                return d?.na ? `날짜 ${String(l)} · ${NA.label}(${NA_REASONS[d.na].short})` : `날짜 ${String(l)}`;
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <details>
        <summary className="cursor-pointer text-xs text-gray-600">표로 보기(접근성 대체)</summary>
        <div className="max-h-64 overflow-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-600">
                <th className="py-1 pr-2">날짜</th>
                <th className="py-1 pr-2">위험지수</th>
                <th className="py-1 pr-2">등급</th>
                <th className="py-1 pr-2">강우</th>
                <th className="py-1 pr-2">평균기온</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.full} className="border-t">
                  <td className="py-0.5 pr-2">{d.full}</td>
                  <td className="py-0.5 pr-2 tabular-nums">{fmtIndex(d.past ?? d.forecast)}</td>
                  <td className="py-0.5 pr-2">{d.grade ?? (d.na ? `${NA.label} · ${NA_REASONS[d.na].short}` : NA.label)}</td>
                  <td className="py-0.5 pr-2 tabular-nums">{d.rain.toFixed(1)}</td>
                  <td className="py-0.5 pr-2 tabular-nums">{d.tavg?.toFixed(1) ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
