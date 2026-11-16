import { redirect } from "next/navigation";

/** 옛 '방제 일정' 메뉴 — '병해충·방제'(/pests)로 합쳤다. 예전 링크·즐겨찾기는 그대로 넘긴다 */
export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ crop?: string }> }) {
  const { crop } = await searchParams;
  redirect(crop ? `/pests?crop=${encodeURIComponent(crop)}` : "/pests");
}
