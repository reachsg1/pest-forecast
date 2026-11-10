import { NextResponse } from "next/server";
import { getRisk } from "@/lib/data";
import { gradeOf } from "@/lib/grades";

// GET /api/v1/risk?pest=apple_anthracnose&offset=3[&format=csv]
export async function GET(req: Request) {
  const url = new URL(req.url);
  const pest = url.searchParams.get("pest") ?? "";
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);
  const format = url.searchParams.get("format") ?? "json";
  if (!pest) return NextResponse.json({ error: "pest 파라미터가 필요합니다" }, { status: 400 });
  const risk = await getRisk(pest);
  if (!risk) return NextResponse.json({ error: "unknown pest" }, { status: 404 });
  const off = Math.min(offset, risk.horizon_days);
  const spots = risk.spots.map((s) => {
    // index=null 이면 '해당 없음'(작물 비재배지 또는 재배 기간 아님). na_reason에 사유.
    const inRange = off < s.index_by_offset.length;
    const index = inRange ? s.index_by_offset[off] : s.index_today;
    const na_reason = index == null ? ((inRange ? s.na_by_offset?.[off] : s.na_today) ?? null) : null;
    return { spot_code: s.spot_code, name: s.name, sigungu: s.sigungu, lat: s.lat, lon: s.lon, index, grade: index == null ? null : gradeOf(index), na_reason, max_index_7d: s.max_index_7d, max_index_10d: s.max_index_10d, data_poor: s.data_poor };
  });
  if (format === "csv") {
    const head = "spot_code,name,sigungu,lat,lon,index,grade,na_reason,max_index_7d,max_index_10d,data_poor";
    const body = spots.map((s) => [s.spot_code, s.name, s.sigungu, s.lat, s.lon, s.index, s.grade, s.na_reason, s.max_index_7d, s.max_index_10d, s.data_poor ? 1 : 0].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    return new NextResponse("﻿" + head + "\n" + body, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="risk_${pest}_${risk.issued_date}_d${off}.csv"` },
    });
  }
  return NextResponse.json({ pest_id: risk.pest_id, name_ko: risk.name_ko, issued_date: risk.issued_date, offset: off, target_date: addDays(risk.issued_date, off), spots });
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
