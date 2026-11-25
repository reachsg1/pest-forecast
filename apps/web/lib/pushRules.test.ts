// node --test lib/pushRules.test.ts  (Node 22.6+ 타입 제거 내장, 추가 설치 없음)
import assert from "node:assert/strict";
import { test } from "node:test";
import { plan, message, type Grade, type Point } from "./pushRules.ts";

const farm = { name: "뒷밭 사과원", crop: "apple", lat: 36.5, lon: 127.5, spot_code: "S1" };
const pests = [
  { pest_id: "apple_anthracnose", name_ko: "사과 탄저병", crop: "apple", crop_ko: "사과" },
  { pest_id: "pepper_anthracnose", name_ko: "탄저병", crop: "pepper", crop_ko: "고추" },
];
const pt = (offset: number, index: number | null, grade: Grade | null): Point => ({ offset, index, grade, date: `2026-07-${String(10 + offset).padStart(2, "0")}` });
const series = (todayIdx: number, todayGrade: Grade, peak?: [number, Grade]) => ({
  S1: { apple_anthracnose: [pt(-1, 20, "정상"), pt(0, todayIdx, todayGrade), pt(3, peak?.[0] ?? todayIdx, peak?.[1] ?? todayGrade)] },
});

test("주의보 이상이고 처음이면 알리고 상태를 남긴다", () => {
  const r = plan([farm], pests, series(62, "주의보", [80, "경보"]), {}, "2026-07-10");
  assert.equal(r.alerts.length, 1);
  assert.equal(r.alerts[0].title, "뒷밭 사과원 · 사과 탄저병 주의보");
  assert.equal(r.alerts[0].body, "오늘 위험지수 62. 7일 내 최고 경보(7.13.). 예방 방제를 검토하세요.");
  assert.deepEqual(r.last, { "S1:apple:apple_anthracnose": { grade: "주의보", date: "2026-07-10" } });
});

test("같은 등급으로 이미 알렸으면 다시 보내지 않는다(같은 날 재실행 포함)", () => {
  const last = { "S1:apple:apple_anthracnose": { grade: "주의보" as Grade, date: "2026-07-09" } };
  const r = plan([farm], pests, series(70, "주의보"), last, "2026-07-10");
  assert.equal(r.alerts.length, 0);
  assert.deepEqual(r.last, last);
});

test("주의보에서 경보로 올라가면 다시 알린다", () => {
  const last = { "S1:apple:apple_anthracnose": { grade: "주의보" as Grade, date: "2026-07-09" } };
  const r = plan([farm], pests, series(81, "경보"), last, "2026-07-10");
  assert.equal(r.alerts.length, 1);
  assert.equal(r.alerts[0].body, "오늘 위험지수 81. 적기 방제가 필요해요.");
  assert.equal(r.last["S1:apple:apple_anthracnose"].grade, "경보");
});

test("예보 이하로 내려가면 상태를 지워 다음 상승 때 다시 알린다", () => {
  const last = { "S1:apple:apple_anthracnose": { grade: "경보" as Grade, date: "2026-07-09" } };
  const down = plan([farm], pests, series(30, "예보"), last, "2026-07-10");
  assert.equal(down.alerts.length, 0);
  assert.deepEqual(down.last, {});
  const up = plan([farm], pests, series(55, "주의보"), down.last, "2026-07-11");
  assert.equal(up.alerts.length, 1);
});

test("해당 없음(index null)·다른 작물·빠진 농장은 알리지 않고 상태를 정리한다", () => {
  const na = { S1: { apple_anthracnose: [pt(0, null, null)] } };
  const stale = { "S1:apple:apple_anthracnose": { grade: "주의보" as Grade, date: "2026-07-01" }, "S9:pepper:pepper_anthracnose": { grade: "경보" as Grade, date: "2026-07-01" } };
  const r = plan([farm], pests, na, stale, "2026-07-10");
  assert.equal(r.alerts.length, 0);
  assert.deepEqual(r.last, {});
});

test("메시지: 7일 내 최고가 오늘과 같은 등급이면 덧붙이지 않고, 작물명이 없는 이름엔 작물을 붙인다", () => {
  const pepper = { ...farm, name: "앞밭", crop: "pepper" };
  const m = message(pepper, pests[1], pt(0, 52, "주의보"), [pt(0, 52, "주의보"), pt(2, 60, "주의보")]);
  assert.equal(m.title, "앞밭 · 고추 탄저병 주의보");
  assert.equal(m.body, "오늘 위험지수 52. 예방 방제를 검토하세요.");
});
