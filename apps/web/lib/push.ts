/**
 * 내 농장 위험도 푸시 알림 — 설정과 구독 저장(서버 전용).
 *
 * 환경변수:
 *   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY   `npx web-push generate-vapid-keys` 로 한 번 만든다(공개키는 브라우저에 내려감)
 *   VAPID_SUBJECT                          운영 연락처 "mailto:…" (푸시 서버가 문제 시 연락하는 주소)
 *   KV_REST_API_URL / KV_REST_API_TOKEN    구독 저장소(lib/kv.ts)
 * 셋 중 하나라도 없으면 pushEnabled() 가 false → 화면에 알림 영역이 나오지 않고 API 는 503 을 돌려준다.
 *
 * 저장 단위는 브라우저의 푸시 구독 하나(= 기기·브라우저 하나). 계정이 아니라 구독 endpoint 의 SHA-256 해시를 id 로 쓴다.
 *   push:sub:<id>   JSON PushSub(구독·농장 — 구독 API 가 씀)      push:subs  SET of id
 *   push:last:<id>  JSON {last, fails}(마지막 알린 등급·연속 실패 수 — 발송 작업만 씀, 90일 뒤 자동 삭제)
 *   두 키를 나눠 발송 작업(최대 60초)과 구독 변경이 서로 덮어쓰지 않게 한다.
 * 저장하는 정보: 구독 endpoint·암호키, 농장 이름·위치·작물·최근접 관측지점, 마지막으로 알린 등급(중복 발송 방지). 다른 개인정보는 없다.
 */
import { cmd, kvReady, pipeline } from "./kv";
import type { AlertState, FarmLite } from "./pushRules";

export type PushSub = {
  id: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  farms: FarmLite[];
  created: string;
  updated: string;
};

export type PushLast = { last: Record<string, AlertState>; fails: number }; // last: `${spot_code}:${crop}:${pest_id}` → 마지막 알림
export const MAX_SUBS = 5000; // 저장소 보호(무료 플랜 기준 넉넉)
const LAST_TTL = 90 * 86400;

export type VapidConf = { publicKey: string; privateKey: string; subject: string };

export function vapid(): VapidConf | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim() ?? "";
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim() ?? "";
  const subject = process.env.VAPID_SUBJECT?.trim() ?? "";
  return publicKey && privateKey && subject.startsWith("mailto:") ? { publicKey, privateKey, subject } : null;
}

export function pushEnabled(): boolean {
  return vapid() !== null && kvReady();
}

const SUBS = "push:subs";
const key = (id: string) => `push:sub:${id}`;
const lastKey = (id: string) => `push:last:${id}`;

function b64url(buf: ArrayBuffer): string {
  let s = "";
  new Uint8Array(buf).forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** endpoint → 저장 id(22자). endpoint 자체는 키 이름에 넣지 않는다 */
export async function subId(endpoint: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return b64url(h).slice(0, 22);
}

export async function getSub(id: string): Promise<PushSub | null> {
  const raw = await cmd<string | null>("GET", key(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PushSub;
  } catch {
    return null;
  }
}

/** 새 구독이면 만들고, 있으면 농장 목록만 갱신(마지막 알림 상태는 다른 키라 그대로). 새 구독은 MAX_SUBS 까지만 */
export async function upsertSub(endpoint: string, keys: PushSub["keys"], farms: FarmLite[]): Promise<PushSub | null> {
  const id = await subId(endpoint);
  const now = new Date().toISOString();
  const prev = await getSub(id);
  if (!prev && ((await cmd<number>("SCARD", SUBS)) ?? 0) >= MAX_SUBS) return null;
  const sub: PushSub = { id, endpoint, keys, farms, created: prev?.created ?? now, updated: now };
  await pipeline([["SET", key(id), JSON.stringify(sub)], ["SADD", SUBS, id]]);
  return sub;
}

export async function getLast(id: string): Promise<PushLast> {
  const raw = await cmd<string | null>("GET", lastKey(id));
  try {
    const j = raw ? (JSON.parse(raw) as Partial<PushLast>) : {};
    return { last: j.last ?? {}, fails: j.fails ?? 0 };
  } catch {
    return { last: {}, fails: 0 };
  }
}

/** 발송 작업이 쓴다. 구독이 그새 지워졌으면(SISMEMBER 0) 남기지 않는다 */
export async function saveLast(id: string, v: PushLast): Promise<void> {
  const [member] = await pipeline<number>([["SISMEMBER", SUBS, id]]);
  if (member) await cmd("SET", lastKey(id), JSON.stringify(v), "EX", LAST_TTL);
}

export async function removeSub(id: string): Promise<boolean> {
  const [n] = await pipeline<number>([["DEL", key(id)], ["DEL", lastKey(id)], ["SREM", SUBS, id]]);
  return n > 0;
}

export async function listSubs(): Promise<PushSub[]> {
  const ids = (await cmd<string[] | null>("SMEMBERS", SUBS)) ?? [];
  if (!ids.length) return [];
  const raws = await pipeline<string | null>(ids.map((id) => ["GET", key(id)]));
  const out: PushSub[] = [];
  const gone: string[] = [];
  raws.forEach((raw, i) => {
    if (!raw) return gone.push(ids[i]);
    try {
      out.push(JSON.parse(raw) as PushSub);
    } catch {
      gone.push(ids[i]);
    }
  });
  if (gone.length) await cmd("SREM", SUBS, ...gone); // 값이 사라진 id 는 집합에서도 정리
  return out;
}
