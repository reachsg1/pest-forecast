import type { Grade, NaReason, PhenologyInfo } from "./types";

// 설계서 3.2 위험도 등급. 색·아이콘·텍스트를 항상 함께 쓴다(접근성).
// bg/text/ring: 배지·타일용 옅은 면 + 같은 계열 테두리. color: 지도·막대 등 채움색.
export const GRADES: { name: Grade; min: number; max: number; color: string; bg: string; text: string; ring: string; icon: string; action: string }[] = [
  { name: "정상", min: 0, max: 24, color: "#a3acb9", bg: "bg-slate-100", text: "text-slate-600", ring: "ring-slate-200", icon: "○", action: "예찰 유지" },
  { name: "예보", min: 25, max: 49, color: "#2e9e5b", bg: "bg-emerald-50", text: "text-emerald-700", ring: "ring-emerald-200", icon: "◔", action: "포장 관찰 강화, 약제 준비" },
  { name: "주의보", min: 50, max: 74, color: "#e8a317", bg: "bg-amber-50", text: "text-amber-700", ring: "ring-amber-200", icon: "◑", action: "예방 방제 검토" },
  { name: "경보", min: 75, max: 100, color: "#d7342c", bg: "bg-red-50", text: "text-red-700", ring: "ring-red-200", icon: "●", action: "적기 방제" },
];

export const GRADE_ORDER: Grade[] = ["정상", "예보", "주의보", "경보"];

export function gradeOf(index: number): Grade {
  const i = Math.max(0, Math.min(100, index));
  for (const g of GRADES) if (i < g.max + 1) return g.name;
  return "경보";
}

export function gradeMeta(grade: Grade) {
  return GRADES.find((g) => g.name === grade) ?? GRADES[0];
}

export function gradeRank(grade: Grade | null | undefined): number {
  return grade ? GRADE_ORDER.indexOf(grade) : -1;
}

// '해당 없음' — 작물이 포장에 없어 위험도를 내지 않은 상태. 4단계 등급과 섞이지 않도록 무채색·점선으로만 표시한다.
export const NA = { label: "해당 없음", icon: "–", color: "#cbd5e1", stroke: "#94a3b8" };

export const NA_REASONS: Record<NaReason, { short: string; long: (crop: string) => string }> = {
  not_grown: { short: "비재배지", long: (crop) => `이 지역은 ${crop} 재배지가 아니어서 위험도를 제공하지 않습니다.` },
  off_season: { short: "재배 시기 아님", long: (crop) => `지금은 이 지역의 ${crop} 재배 기간이 아니어서 위험도를 제공하지 않습니다.` },
};

const LEVEL_LABEL: Record<string, string> = { sigungu: "시군", sido: "시도", zone: "권역", national: "전국" };

/** 재배 기간 설명 한 줄. 예: "04-05~11-20 · 경북 청송군 기준" */
export function windowText(p: PhenologyInfo | null | undefined): string | null {
  if (!p?.window) return null;
  const where = p.window_level === "national" ? "전국 기준" : `${p.window_region ?? ""} ${LEVEL_LABEL[p.window_level ?? ""] ?? ""} 기준`.trim();
  return `${p.window.replace("~", " ~ ")} · ${where}`;
}

/** '사과 탄저병'처럼 이름에 작물명이 이미 있으면 다시 붙이지 않는다. '복숭아순나방' → '사과 복숭아순나방' */
export function pestFullName(cropKo: string, nameKo: string): string {
  return nameKo.startsWith(cropKo) ? nameKo : `${cropKo} ${nameKo}`;
}

/** 위험지수 표시용. 해당 없음이면 대시. */
export function fmtIndex(v: number | null | undefined): string {
  return v == null ? "–" : String(Math.round(v));
}

export const CROP_LABEL: Record<string, string> = { rice: "벼", apple: "사과", pepper: "고추", pear: "배", peach: "복숭아" };
export const TYPE_LABEL: Record<string, string> = { A: "감염 조건 모델", B: "발육 단계(적산온도) 모델", C: "통계·기계학습 모델" };
