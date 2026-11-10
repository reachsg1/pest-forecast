import { NextResponse } from "next/server";
import { getPest } from "@/lib/data";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pest = await getPest(id);
  if (!pest) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(pest);
}
