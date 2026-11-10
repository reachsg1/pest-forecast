import { NextResponse } from "next/server";
import { getSpots } from "@/lib/data";

export async function GET() {
  return NextResponse.json(await getSpots());
}
