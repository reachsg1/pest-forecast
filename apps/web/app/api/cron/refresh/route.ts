import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

// 배치 완료 후 GitHub Actions가 호출: POST /api/cron/refresh (Authorization: Bearer $CRON_SECRET)
// 1단계(정적 JSON 커밋 → 재배포) 구조에서는 필수가 아니며, DB/Blob으로 옮기면 캐시 무효화에 쓴다.
export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET ?? "";
  if (!secret || auth !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  for (const p of ["/", "/map", "/pests", "/about", "/data"]) revalidatePath(p);
  return NextResponse.json({ ok: true, refreshed_at: new Date().toISOString() });
}
