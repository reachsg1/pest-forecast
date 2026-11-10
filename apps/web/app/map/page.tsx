import { Suspense } from "react";
import type { Metadata } from "next";
import MapView from "@/components/MapView";
import { PageHeader } from "@/components/ui";
import { getPests, getSpots, getSummary } from "@/lib/data";

export const metadata: Metadata = { title: "예측 지도" };

export default async function MapPage() {
  const [pests, spots, summary] = await Promise.all([getPests(), getSpots(), getSummary()]);
  const pestList = pests.map((p) => ({ pest_id: p.pest_id, name_ko: p.name_ko, crop: p.crop, crop_ko: p.crop_ko, horizon_days: p.horizon_days }));
  return (
    <div className="space-y-6">
      <PageHeader eyebrow={`기준일 ${summary?.issued_date ?? "-"}`} title="예측 지도" desc="작물과 병해충, 전망일을 고르면 관측지점별 위험도를 지도에서 볼 수 있습니다." />
      <Suspense fallback={<div className="h-[62vh] animate-pulse rounded-2xl bg-slate-100" />}>
        <MapView pests={pestList} spots={spots} horizon={summary?.horizon_days ?? 10} issuedDate={summary?.issued_date ?? ""} />
      </Suspense>
    </div>
  );
}
