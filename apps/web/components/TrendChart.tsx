"use client";

import { useMemo } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { GRADES } from "@/lib/grades";
import type { SeriesPoint, WeatherDay } from "@/lib/types";

export default function TrendChart({ series, weather, issuedDate }: { series: SeriesPoint[]; weather: WeatherDay[]; issuedDate: string }) {
  const data = useMemo(() => {
    const wx = new Map(weather.map((w) => [w.date, w]));
    return series.map((p) => {
      const w = wx.get(p.date);
      return {
        date: p.date.slice(5),
        full: p.date,
        past: p.is_forecast ? null : p.index,
        forecast: p.is_forecast || p.offset === 0 ? p.index : null,
        rain: w?.rain ?? 0,
        tavg: w?.tavg ?? null,
        grade: p.grade,
      };
    });
  }, [series, weather]);

  if (!data.length) return <p className="text-sm text-gray-500">추이 자료가 없습니다.</p>;
  const todayLabel = issuedDate.slice(5);

  return (
    <div className="space-y-2">
      <div className="h-72 w-full">
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} interval={4} />
            <YAxis yAxisId="risk" domain={[0, 100]} tick={{ fontSize: 11 }} width={32} />
            <YAxis yAxisId="wx" orientation="right" tick={{ fontSize: 11 }} width={36} />
            <ReferenceArea yAxisId="risk" y1={75} y2={100} fill={GRADES[3].color} fillOpacity={0.06} />
            <ReferenceArea yAxisId="risk" y1={50} y2={75} fill={GRADES[2].color} fillOpacity={0.06} />
            <ReferenceLine yAxisId="risk" x={todayLabel} stroke="#555" strokeDasharray="4 4" label={{ value: "오늘", position: "insideTopRight", fontSize: 11 }} />
            <Bar yAxisId="wx" dataKey="rain" name="일강우(mm)" fill="#7fb3d5" barSize={6} />
            <Line yAxisId="wx" type="monotone" dataKey="tavg" name="평균기온(℃)" stroke="#999" dot={false} strokeWidth={1} />
            <Line yAxisId="risk" type="monotone" dataKey="past" name="위험지수(관측)" stroke="#1f6f4a" strokeWidth={2.5} dot={false} connectNulls={false} />
            <Line yAxisId="risk" type="monotone" dataKey="forecast" name="위험지수(예측)" stroke="#1f6f4a" strokeWidth={2.5} strokeDasharray="5 4" dot={false} connectNulls={false} />
            <Tooltip
              formatter={(v: unknown, name: unknown) => [typeof v === "number" ? v.toFixed(1) : String(v ?? ""), String(name)]}
              labelFormatter={(l: unknown) => `날짜 ${String(l)}`}
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
                  <td className="py-0.5 pr-2 tabular-nums">{(d.past ?? d.forecast ?? 0).toFixed(0)}</td>
                  <td className="py-0.5 pr-2">{d.grade}</td>
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
