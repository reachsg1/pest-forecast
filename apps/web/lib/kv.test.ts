// node --test lib/kv.test.ts  — 연결 방식 선택(순수 함수)만 검사한다. 실제 접속은 하지 않는다.
import assert from "node:assert/strict";
import { test } from "node:test";
import { backendFor } from "./kv.ts";

test("REST 값이 있으면 Upstash REST(끝 슬래시 제거)", () => {
  const b = backendFor({ KV_REST_API_URL: "https://x.upstash.io/", KV_REST_API_TOKEN: "t", REDIS_URL: "redis://u:p@h:6379" });
  assert.deepEqual(b, { kind: "rest", url: "https://x.upstash.io", token: "t" });
  assert.equal(backendFor({ UPSTASH_REDIS_REST_URL: "https://y.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t2" })?.kind, "rest");
});

test("REST 가 없고 REDIS_URL(또는 KV_URL)이 redis(s):// 면 일반 Redis", () => {
  assert.deepEqual(backendFor({ REDIS_URL: " rediss://default:pw@host:12345 " }), { kind: "tcp", url: "rediss://default:pw@host:12345" });
  assert.equal(backendFor({ KV_URL: "redis://h:6379" })?.kind, "tcp");
  assert.equal(backendFor({ REDIS_URL: "https://not-redis" }), null);
});

test("토큰만 있거나 아무것도 없으면 null(알림 꺼짐)", () => {
  assert.equal(backendFor({ KV_REST_API_TOKEN: "t" }), null);
  assert.equal(backendFor({}), null);
});
