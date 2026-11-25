/**
 * 농장 알림 판정(순수 함수 — 서버·테스트에서 같이 쓴다. `@/` 별칭 없이 상대 경로만).
 *
 * 규칙:
 *  - 농장의 최근접 관측지점에서 그 작물 병해충의 오늘(offset 0) 등급이 '주의보' 이상이고,
 *    마지막으로 알린 등급보다 높아졌을 때만 알린다(처음이면 주의보 이상이면 알림). → "위험도가 높아지면" 알림
 *  - 등급이 '예보' 이하로 내려가면 마지막 알림 상태를 지워, 다음에 다시 올라올 때 또 알린다.
 *  - 같은 날 다시 실행해도 상태가 같으면 보내지 않는다(배치 재실행·예비 크론에 안전).
 */

export type Grade = "정상" | "예보" | "주의보" | "경보";

/** "2026-09-30" → "9.30."(lib/format.fmtMD 와 같음 — node --test 에서 바로 돌릴 수 있게 의존성 없이 둔다) */
const fmtMD = (s: string) => {
  const m = /(?:\d{4}-)?(\d{2})-(\d{2})$/.exec(s);
  return m ? `${Number(m[1])}.${Number(m[2])}.` : s;
};
const ORDER: Grade[] = ["정상", "예보", "주의보", "경보"];
export const ALERT_MIN: Grade = "주의보";
const ACTION: Record<Grade, string> = { 정상: "예찰 유지", 예보: "포장 관찰 강화, 약제 준비", 주의보: "예방 방제를 검토하세요.", 경보: "적기 방제가 필요해요." };

export type FarmLite = { name: string; crop: string; lat: number; lon: number; spot_code: string };
export type PestLite = { pest_id: string; name_ko: string; crop: string; crop_ko: string };
export type Point = { offset: number; index: number | null; grade: Grade | null; date: string };
export type AlertState = { grade: Grade; date: string };
export type Alert = { key: string; farm: FarmLite; pest: PestLite; grade: Grade; index: number; title: string; body: string };

export const rank = (g: Grade | null | undefined): number => (g ? ORDER.indexOf(g) : -1);
export const alertKey = (farm: FarmLite, pestId: string) => `${farm.spot_code}:${farm.crop}:${pestId}`;

/** '사과 탄저병'처럼 이름에 작물명이 이미 있으면 다시 붙이지 않는다(lib/grades.pestFullName 과 같음) */
const fullName = (p: PestLite) => (p.name_ko.startsWith(p.crop_ko) ? p.name_ko : `${p.crop_ko} ${p.name_ko}`);

export function message(farm: FarmLite, pest: PestLite, today: Point, series: Point[]): { title: string; body: string } {
  const grade = today.grade as Grade;
  let peak: Point | null = null;
  for (const x of series) if (x.offset > 0 && x.offset <= 7 && x.index != null && (peak == null || x.index > (peak.index as number))) peak = x;
  const peakTxt = peak && peak.grade && rank(peak.grade) > rank(grade) ? ` 7일 내 최고 ${peak.grade}(${fmtMD(peak.date)}).` : "";
  return {
    title: `${farm.name} · ${fullName(pest)} ${grade}`,
    body: `오늘 위험지수 ${Math.round(today.index as number)}.${peakTxt} ${ACTION[grade]}`,
  };
}

/**
 * 구독 하나의 농장들을 훑어 보낼 알림과 새 상태를 돌려준다.
 * @param series  spot_code → pest_id → 시계열(오늘 offset 0 포함)
 * @param last    마지막 알림 상태(alertKey → {grade, date})
 * @param today   기준일 ISO(YYYY-MM-DD) — 상태 기록용
 */
export function plan(
  farms: FarmLite[],
  pests: PestLite[],
  series: Record<string, Record<string, Point[]> | undefined>,
  last: Record<string, AlertState>,
  today: string,
): { alerts: Alert[]; last: Record<string, AlertState> } {
  const next: Record<string, AlertState> = { ...last };
  const alerts: Alert[] = [];
  for (const farm of farms) {
    for (const pest of pests.filter((p) => p.crop === farm.crop)) {
      const key = alertKey(farm, pest.pest_id);
      const s = series[farm.spot_code]?.[pest.pest_id] ?? [];
      const t = s.find((x) => x.offset === 0);
      if (!t || t.grade == null || t.index == null || rank(t.grade) < rank(ALERT_MIN)) {
        delete next[key]; // 내려갔거나 해당 없음 → 다음 상승 때 다시 알림
        continue;
      }
      if (rank(t.grade) <= rank(next[key]?.grade)) continue; // 이미 이 등급(이상)으로 알렸음
      alerts.push({ key, farm, pest, grade: t.grade, index: t.index, ...message(farm, pest, t, s) });
      next[key] = { grade: t.grade, date: today };
    }
  }
  // 구독에서 빠진 농장의 상태는 정리
  const live = new Set(farms.flatMap((f) => pests.filter((p) => p.crop === f.crop).map((p) => alertKey(f, p.pest_id))));
  for (const k of Object.keys(next)) if (!live.has(k)) delete next[k];
  return { alerts, last: next };
}
