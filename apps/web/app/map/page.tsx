import { Suspense } from "react";
import type { Metadata } from "next";
import MapView from "@/components/MapView";
import { getPests, getSpots, getSummary } from "@/lib/data";

export const metadata: Metadata = { title: "예측 지도" };

export default async function MapPage() {
  const [pests, spots, summary] = await Promise.all([getPests(), getSpots(), getSummary()]);
  const pestList = pests.map((p) => ({ pest_id: p.pest_id, name_ko: p.name_ko, crop: p.crop, crop_ko: p.crop_ko, horizon_days: p.horizon_days }));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="page-title">예측 지도</h1>
        <p className="num text-xs text-slate-400">기준일 {summary?.issued_date ?? "-"} · 관측지점 {spots.length}곳 · 원을 누르면 지점 상세</p>
      </div>
      <Suspense fallback={<div className="h-[calc(100vh-12rem)] min-h-[560px] animate-pulse rounded-3xl bg-slate-200" />}>
        <MapView pests={pestList} spots={spots} horizon={summary?.horizon_days ?? 10} issuedDate={summary?.issued_date ?? ""} />
      </Suspense>
    </div>
  );
}
