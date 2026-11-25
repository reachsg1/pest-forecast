import { NextResponse } from "next/server";
import { pushEnabled, removeSub, subId, upsertSub } from "@/lib/push";
import type { FarmLite } from "@/lib/pushRules";

/**
 * 내 농장 알림 구독(로그인이 켜져 있으면 미들웨어가 쿠키를 요구한다).
 *   POST   { subscription: PushSubscriptionJSON, farms: FarmLite[] }  — 새 구독 저장 또는 농장 목록 갱신
 *   DELETE { endpoint }                                              — 구독 삭제(알림 끄기)
 * 저장되는 것은 구독 endpoint·암호키와 농장 이름·위치·작물·최근접 관측지점뿐이다.
 */
const MAX_FARMS = 10;
// 푸시 서버 호스트 허용 목록(Chrome·Firefox·Edge·Safari·Samsung). 임의 주소를 등록해 서버가 아무 곳에나 요청하게 두지 않는다
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)push\.samsungosp\.com$/];
const B64URL = /^[A-Za-z0-9_-]+$/;
const b64len = (s: string) => Math.floor((s.length * 3) / 4); // 패딩 없는 base64url 의 바이트 수
const str = (v: unknown, max: number) => (typeof v === "string" && v.length > 0 && v.length <= max ? v : null);
const inKorea = (lat: number, lon: number) => lat > 32 && lat < 39.5 && lon > 124 && lon < 132;

function parseFarms(v: unknown): FarmLite[] | null {
  if (!Array.isArray(v) || v.length > MAX_FARMS) return null;
  const out: FarmLite[] = [];
  for (const f of v as Record<string, unknown>[]) {
    const name = str(f?.name, 40);
    const crop = str(f?.crop, 20);
    const spot = str(f?.spot_code, 20);
    const lat = Number(f?.lat);
    const lon = Number(f?.lon);
    if (!name || !crop || !spot || !/^[A-Za-z0-9_-]+$/.test(spot) || !/^[a-z_]+$/.test(crop) || !Number.isFinite(lat) || !Number.isFinite(lon) || !inKorea(lat, lon)) return null;
    out.push({ name, crop, lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4, spot_code: spot });
  }
  return out;
}

function parseSubscription(v: unknown): { endpoint: string; keys: { p256dh: string; auth: string } } | null {
  const s = v as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | undefined;
  const endpoint = str(s?.endpoint, 2000);
  const p256dh = str(s?.keys?.p256dh, 120);
  const auth = str(s?.keys?.auth, 40);
  if (!endpoint || !p256dh || !auth) return null;
  let host = "";
  try {
    const u = new URL(endpoint);
    if (u.protocol !== "https:") return null;
    host = u.hostname;
  } catch {
    return null;
  }
  if (!PUSH_HOSTS.some((re) => re.test(host))) return null;
  // p256dh = 압축 안 한 P-256 공개키 65바이트, auth = 16바이트
  if (!B64URL.test(p256dh) || b64len(p256dh) !== 65 || !B64URL.test(auth) || b64len(auth) !== 16) return null;
  return { endpoint, keys: { p256dh, auth } };
}

const off = () => NextResponse.json({ error: "알림 기능이 아직 켜져 있지 않아요" }, { status: 503 });
const storeDown = () => NextResponse.json({ error: "저장소에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요." }, { status: 502 });

export async function POST(req: Request) {
  if (!pushEnabled()) return off();
  const body = (await req.json().catch(() => null)) as { subscription?: unknown; farms?: unknown } | null;
  const sub = parseSubscription(body?.subscription);
  const farms = parseFarms(body?.farms);
  if (!sub || !farms) return NextResponse.json({ error: "구독 정보나 농장 목록이 올바르지 않아요" }, { status: 400 });
  try {
    const saved = await upsertSub(sub.endpoint, sub.keys, farms);
    if (!saved) return NextResponse.json({ error: "알림 신청이 너무 많아 지금은 더 받을 수 없어요." }, { status: 429 });
    return NextResponse.json({ ok: true, farms: saved.farms.length });
  } catch {
    return storeDown();
  }
}

export async function DELETE(req: Request) {
  if (!pushEnabled()) return off();
  const body = (await req.json().catch(() => null)) as { endpoint?: unknown } | null;
  const endpoint = str(body?.endpoint, 2000);
  if (!endpoint) return NextResponse.json({ error: "endpoint 가 필요해요" }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, removed: await removeSub(await subId(endpoint)) });
  } catch {
    return storeDown();
  }
}
