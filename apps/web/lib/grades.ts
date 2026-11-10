import type { Grade } from "./types";

// 설계서 3.2 위험도 등급. 색·아이콘·텍스트를 항상 함께 쓴다(접근성).
export const GRADES: { name: Grade; min: number; max: number; color: string; bg: string; text: string; icon: string; action: string }[] = [
  { name: "정상", min: 0, max: 24, color: "#9ca3af", bg: "bg-gray-100", text: "text-gray-700", icon: "○", action: "예찰 유지" },
  { name: "예보", min: 25, max: 49, color: "#2e9e5b", bg: "bg-green-100", text: "text-green-800", icon: "◔", action: "포장 관찰 강화, 약제 준비" },
  { name: "주의보", min: 50, max: 74, color: "#e8a317", bg: "bg-amber-100", text: "text-amber-900", icon: "◑", action: "예방 방제 검토" },
  { name: "경보", min: 75, max: 100, color: "#d7342c", bg: "bg-red-100", text: "text-red-900", icon: "●", action: "적기 방제" },
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

export function gradeRank(grade: Grade): number {
  return GRADE_ORDER.indexOf(grade);
}

export const CROP_LABEL: Record<string, string> = { rice: "벼", apple: "사과", pepper: "고추", pear: "배", peach: "복숭아" };
export const TYPE_LABEL: Record<string, string> = { A: "감염 조건 모델", B: "발육 단계(적산온도) 모델", C: "통계·기계학습 모델" };
