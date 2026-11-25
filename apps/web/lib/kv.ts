/**
 * Upstash Redis REST 최소 클라이언트(의존성 없음). 농장 알림 구독 저장에 쓴다.
 *
 * 환경변수(Vercel Marketplace → Upstash Redis 를 연결하면 자동 등록):
 *   KV_REST_API_URL / KV_REST_API_TOKEN   또는   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
 * 둘 다 없으면 kvReady() 가 false 를 돌려주고 알림 기능은 꺼진 채 동작한다.
 * 토큰은 로그·오류 메시지에 절대 넣지 않는다.
 */
type Conf = { url: string; token: string };

function conf(): Conf | null {
  const url = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "").trim();
  const token = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();
  return url && token ? { url: url.replace(/\/+$/, ""), token } : null;
}

export function kvReady(): boolean {
  return conf() !== null;
}

async function post<T>(c: Conf, path: string, body: unknown): Promise<T> {
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

/** 명령 하나. 예: cmd("GET", "push:sub:abc") → 값(없으면 null) */
export async function cmd<T = unknown>(...args: (string | number)[]): Promise<T> {
  const c = conf();
  if (!c) throw new Error("kv 설정 없음");
  const j = await post<{ result?: T; error?: string }>(c, "", args);
  if (j.error) throw new Error(`kv 오류: ${j.error}`);
  return j.result as T;
}

/** 여러 명령을 한 번에(순서대로 결과 배열) */
export async function pipeline<T = unknown>(cmds: (string | number)[][]): Promise<T[]> {
  if (!cmds.length) return [];
  const c = conf();
  if (!c) throw new Error("kv 설정 없음");
  const j = await post<{ result?: T; error?: string }[]>(c, "/pipeline", cmds);
  return j.map((x) => {
    if (x.error) throw new Error(`kv 오류: ${x.error}`);
    return x.result as T;
  });
}
