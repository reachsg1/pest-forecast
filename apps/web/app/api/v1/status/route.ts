import { NextResponse } from "next/server";
import { getStatus } from "@/lib/data";

export async function GET() {
  const status = await getStatus();
  if (!status) return NextResponse.json({ ok: false, error: "no data" }, { status: 503 });
  return NextResponse.json(status);
}
