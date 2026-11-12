import { Suspense } from "react";
import type { Metadata } from "next";
import FarmClient from "@/components/FarmClient";
import { PageHeader } from "@/components/ui";
import { getPests, getSpots, getSummary } from "@/lib/data";

export const metadata: Metadata = { title: "내 농장 위험도" };

export default async function FarmPage() {
  const [spots, pests, summary] = await Promise.all([getSpots(), getPests(), getSummary()]);
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="농장 맞춤"
        title="내 농장 위험도"
        desc={`농장 위치와 작물을 등록하면 가장 가까운 관측지점 기준으로 ${summary?.horizon_days ?? 10}일 위험도를 보여줍니다. 등록 정보는 이 브라우저에만 저장되며 서버로 보내지 않습니다.`}
      />
      <Suspense fallback={null}>
        <FarmClient spots={spots} pests={pests.map((p) => ({ pest_id: p.pest_id, name_ko: p.name_ko, crop: p.crop, crop_ko: p.crop_ko }))} horizon={summary?.horizon_days ?? 10} />
      </Suspense>
    </div>
  );
}
