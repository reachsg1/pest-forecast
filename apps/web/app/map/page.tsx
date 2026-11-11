import { Suspense } from "react";
import type { Metadata } from "next";
import MapView from "@/components/MapView";
import { getPests, getSpots, getSummary } from "@/lib/data";
import type { ModelLite } from "@/lib/types";
import { fmtDate } from "@/lib/format";

export const metadata: Metadata = { title: "예측 지도" };

export default async function MapPage() {
  const [pests, spots, summary] = await Promise.all([getPests(), getSpots(), getSummary()]);
  const pestList = pests.map((p) => ({
    pest_id: p.pest_id,
    name_ko: p.name_ko,
    crop: p.crop,
    crop_ko: p.crop_ko,
    horizon_days: p.horizon_days,
    // 이 병해충에 등록된 모델들(첫 번째 = 기본). 예전 데이터처럼 목록이 없으면 기본 모델 1개로 본다.
    models: (p.models?.map((m) => {
      const t = m.eval?.status === "survey_evaluated" ? m.eval.test : undefined;
      return {
        model_id: m.model_id,
        label: m.label,
        type: m.type,
        is_default: m.is_default,
        demo_only: m.demo_only,
        algorithm: m.eval?.algorithm,
        perf: t ? { auc: t.auc.survey_logit, accuracy: t.classification?.survey_logit?.accuracy ?? null, within: t.within_round_auc.survey_logit } : null,
      };
    }) ?? [
      { model_id: p.id, label: p.label ?? "기본 모델", type: p.type, is_default: true },
    ]) as ModelLite[],
  }));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="page-title">예측 지도</h1>
        <p className="num text-xs text-slate-400">기준일 {fmtDate(summary?.issued_date)} · 관측지점 {spots.length}곳 · 원을 누르면 지점 상세</p>
      </div>
      <Suspense fallback={<div className="h-[calc(100vh-12rem)] min-h-[560px] animate-pulse rounded-3xl bg-slate-200" />}>
        <MapView pests={pestList} spots={spots} horizon={summary?.horizon_days ?? 10} issuedDate={summary?.issued_date ?? ""} />
      </Suspense>
    </div>
  );
}
