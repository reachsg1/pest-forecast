import { NextResponse } from "next/server";
import { getPests, getSpotFile, getSpots, haversineKm } from "@/lib/data";

// GET /api/v1/risk/nearest?lat=36.5&lon=127.5&crop=apple
export async function GET(req: Request) {
  const u = new URL(req.url);
  const lat = Number(u.searchParams.get("lat"));
  const lon = Number(u.searchParams.get("lon"));
  const crop = u.searchParams.get("crop") ?? "";
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return NextResponse.json({ error: "lat, lon 이 필요합니다" }, { status: 400 });
  const spots = (await getSpots()).filter((s) => s.lat != null && s.lon != null);
  if (!spots.length) return NextResponse.json({ error: "no spots" }, { status: 503 });
  let best = spots[0];
  let bestD = Infinity;
  for (const s of spots) {
    const d = haversineKm(lat, lon, s.lat as number, s.lon as number);
    if (d < bestD) {
      best = s;
      bestD = d;
    }
  }
  const file = await getSpotFile(best.spot_code);
  const pests = (await getPests()).filter((p) => !crop || p.crop === crop);
  const risks = pests.map((p) => {
    const s = file?.series[p.pest_id] ?? [];
    return { pest_id: p.pest_id, name_ko: p.name_ko, crop: p.crop, timeline: s.filter((x) => x.offset >= 0).map((x) => ({ date: x.date, offset: x.offset, index: x.index, grade: x.grade })) };
  });
  return NextResponse.json({ spot: { spot_code: best.spot_code, name: best.name, sigungu: best.sigungu, lat: best.lat, lon: best.lon, distance_km: Math.round(bestD * 10) / 10 }, issued_date: file?.issued_date, risks });
}
