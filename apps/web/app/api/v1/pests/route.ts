import { NextResponse } from "next/server";
import { getPests } from "@/lib/data";

export async function GET() {
  return NextResponse.json(await getPests());
}
