import { Suspense } from "react";
import type { Metadata } from "next";
import MapView from "@/components/MapView";
import { getPests, getSpots, getSummary } from "@/lib/data";

export const metadata: Metadata = { title: "예측 지도" };

export default async function MapPage() {
  const [pests, spots, summary] = await Promise.all([getPests(), getSpots(), getSummary()]);
  const pestList = pests.map((p) => ({ pest_id: p.pest_id, name_ko: p.name_ko, crop: p.crop, crop_ko: p.crop_ko, horizon_days: p.horizon_days }));
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-bold">
        예측 지도 <span className="text-sm font-normal text-gray-500">기준일 {summary?.issued_date ?? "-"}</span>
      </h1>
      <Suspense fallback={<div className="h-[60vh] animate-pulse rounded-lg bg-gray-100" />}>
        <MapView pests={pestList} spots={spots} horizon={summary?.horizon_days ?? 10} issuedDate={summary?.issued_date ?? ""} />
      </Suspense>
    </div>
  );
}
