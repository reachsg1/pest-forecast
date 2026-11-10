import { NextResponse } from "next/server";
import { getSpotFile } from "@/lib/data";

// GET /api/v1/risk/spot/{spot_code}[?pest=...]
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const pest = new URL(req.url).searchParams.get("pest");
  const file = await getSpotFile(code);
  if (!file) return NextResponse.json({ error: "unknown spot" }, { status: 404 });
  if (pest) {
    const series = file.series[pest];
    if (!series) return NextResponse.json({ error: "unknown pest for this spot" }, { status: 404 });
    return NextResponse.json({ ...file, series: { [pest]: series } });
  }
  return NextResponse.json(file);
}
