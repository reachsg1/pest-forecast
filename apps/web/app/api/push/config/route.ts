import { NextResponse } from "next/server";
import { pushEnabled, vapid } from "@/lib/push";

/** GET /api/push/config → 알림 기능 사용 가능 여부와 VAPID 공개키(브라우저 구독용). 비밀값은 내려가지 않는다 */
export async function GET() {
  const enabled = pushEnabled();
  return NextResponse.json({ enabled, publicKey: enabled ? vapid()?.publicKey : null }, { headers: { "Cache-Control": "no-store" } });
}
