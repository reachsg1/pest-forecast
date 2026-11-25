/**
 * 농장 알림 구독 저장용 Redis 최소 클라이언트. 두 가지 연결 방식을 지원한다(환경변수로 고름, 코드는 같음):
 *
 *   1) Upstash REST   KV_REST_API_URL / KV_REST_API_TOKEN  또는  UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
 *   2) 일반 Redis     REDIS_URL  (또는 KV_URL) — redis:// 또는 rediss:// 접속 주소.
 *                     Vercel Marketplace 의 Redis(Redis Cloud) 를 Connect 하면 REDIS_URL 이 자동 등록된다.
 *
 * REST 값이 있으면 REST 를, 없고 REDIS_URL 만 있으면 node-redis 로 붙는다. 둘 다 없으면 kvReady() 가 false 를
 * 돌려주고 알림 기능은 꺼진 채 동작한다. 토큰·접속 주소(비밀번호 포함)는 로그·오류 메시지에 절대 넣지 않는다.
 */
import { createClient, type RedisClientType } from "redis";

type Rest = { kind: "rest"; url: string; token: string };
type Tcp = { kind: "tcp"; url: string };
export type Backend = Rest | Tcp;

type Env = Record<string, string | undefined>;

/** 환경변수 → 연결 방식. 순수 함수(테스트용으로 env 를 넘길 수 있다) */
export function backendFor(env: Env = process.env): Backend | null {
  const restUrl = (env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL || "").trim();
  const restToken = (env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN || "").trim();
  if (restUrl && restToken) return { kind: "rest", url: restUrl.replace(/\/+$/, ""), token: restToken };
  const tcp = (env.REDIS_URL || env.KV_URL || "").trim();
  if (/^rediss?:\/\//.test(tcp)) return { kind: "tcp", url: tcp };
  return null;
}

export function kvReady(): boolean {
  return backendFor() !== null;
}

// --- Upstash REST ---------------------------------------------------------------------------------
async function restPost<T>(c: Rest, path: string, body: unknown): Promise<T> {
  const r = await fetch(`${c.url}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`kv ${path} 실패: HTTP ${r.status}`);
  return (await r.json()) as T;
}

// --- 일반 Redis(node-redis) ---------------------------------------------------------------------------
// 서버리스 함수는 호출마다 새 프로세스일 수 있어 연결을 모듈 전역에 하나만 두고, 끊겨 있으면 다시 만든다.
let tcpClient: RedisClientType | null = null;

async function tcp(c: Tcp): Promise<RedisClientType> {
  if (tcpClient?.isOpen) return tcpClient;
  const client = createClient({ url: c.url, socket: { connectTimeout: 8000, reconnectStrategy: false } }) as RedisClientType;
  client.on("error", () => {
    /* 연결 오류는 호출 쪽에서 잡는다. 접속 주소가 섞인 메시지를 로그에 남기지 않는다 */
  });
  try {
    await client.connect();
  } catch {
    throw new Error("kv 연결 실패(REDIS_URL)");
  }
  tcpClient = client;
  return client;
}

// node-redis 는 상태 오류 때 접속 주소가 든 메시지를 낼 수 있어 일반 문구로 바꾼다
async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("kv ")) throw e;
    tcpClient = null;
    throw new Error("kv 명령 실패(REDIS_URL)");
  }
}

const strs = (args: (string | number)[]) => args.map(String);

// --- 공통 API ----------------------------------------------------------------------------------------
/** 명령 하나. 예: cmd("GET", "push:sub:abc") → 값(없으면 null) */
export async function cmd<T = unknown>(...args: (string | number)[]): Promise<T> {
  const c = backendFor();
  if (!c) throw new Error("kv 설정 없음");
  if (c.kind === "tcp") return guarded(async () => (await (await tcp(c)).sendCommand(strs(args))) as T);
  const j = await restPost<{ result?: T; error?: string }>(c, "", args);
  if (j.error) throw new Error(`kv 오류: ${j.error}`);
  return j.result as T;
}

/** 여러 명령을 한 번에(순서대로 결과 배열) */
export async function pipeline<T = unknown>(cmds: (string | number)[][]): Promise<T[]> {
  if (!cmds.length) return [];
  const c = backendFor();
  if (!c) throw new Error("kv 설정 없음");
  if (c.kind === "tcp") {
    return guarded(async () => {
      const client = await tcp(c);
      const multi = client.multi();
      for (const x of cmds) multi.addCommand(strs(x));
      return (await multi.execAsPipeline()) as T[];
    });
  }
  const j = await restPost<{ result?: T; error?: string }[]>(c, "/pipeline", cmds);
  return j.map((x) => {
    if (x.error) throw new Error(`kv 오류: ${x.error}`);
    return x.result as T;
  });
}
