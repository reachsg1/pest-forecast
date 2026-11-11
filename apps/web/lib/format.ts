/**
 * 화면 날짜 표기: 점 형식(2026.11.11. / 9.30.). 데이터·API는 ISO(YYYY-MM-DD)를 그대로 쓰고 표시할 때만 바꾼다.
 */

/** "2026-11-11" → "2026.11.11." */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[1]}.${Number(m[2])}.${Number(m[3])}.` : iso;
}

/** "2026-09-30" 또는 "09-30" → "9.30." */
export function fmtMD(s: string | null | undefined): string {
  if (!s) return "-";
  const m = /(?:\d{4}-)?(\d{2})-(\d{2})$/.exec(s);
  return m ? `${Number(m[1])}.${Number(m[2])}.` : s;
}

/** "2026-11-11T15:49:49" → "2026.11.11. 15:49" */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const [d, t = ""] = iso.split("T");
  return `${fmtDate(d)}${t ? ` ${t.slice(0, 5)}` : ""}`;
}

/** 문장 안의 MM-DD·YYYY-MM-DD 를 모두 점 형식으로("05-01~10-31" → "5.1.~10.31.") */
export function fmtDatesIn(text: string): string {
  return text.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_, y, m, d) => `${y}.${Number(m)}.${Number(d)}.`).replace(/\b(\d{2})-(\d{2})\b/g, (_, m, d) => `${Number(m)}.${Number(d)}.`);
}
