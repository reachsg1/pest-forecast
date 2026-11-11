"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import RiskBadge from "./RiskBadge";
import Sparkline from "./Sparkline";
import { Icon } from "./ui";
import { NA_REASONS, gradeOf, pestFullName, perfText, windowText } from "@/lib/grades";
import type { ModelLite, SpotFile, SurveyRef } from "@/lib/types";

type PestLite = { pest_id: string; name_ko: string; crop: string; crop_ko: string };

const ADVICE: Record<string, string> = {
  정상: "평소처럼 포장을 관찰하세요.",
  예보: "발생에 대비해 포장을 자주 살펴보세요.",
  주의보: "예방 약제 살포를 검토하세요.",
  경보: "등록 약제로 적기에 방제하세요.",
};

export default function SpotPanel({ code, pestId, model, models = [], pests, horizon, onClose }: { code: string; pestId: string; model?: ModelLite; models?: ModelLite[]; pests: PestLite[]; horizon: number; onClose?: () => void }) {
  const [data, setData] = useState<SpotFile | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let alive = true;
    setData(null);
    setErr(false);
    fetch(`/data/spot/${code}.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => alive && setData(j))
      .catch(() => alive && setErr(true));
    return () => {
      alive = false;
    };
  }, [code]);

  if (err) return <p className="text-sm text-red-700">지점 자료를 불러오지 못했습니다. ({code})</p>;
  if (!data)
    return (
      <div className="space-y-3" aria-busy="true">
        <div className="h-5 w-32 animate-pulse rounded bg-slate-100" />
        <div className="h-9 w-24 animate-pulse rounded-full bg-slate-100" />
        <div className="h-16 animate-pulse rounded-xl bg-slate-100" />
      </div>
    );

  // 추가 모델을 골랐으면 그 모델의 시계열, 아니면 기본 모델
  const series = (model && !model.is_default ? data.series_by_model?.[model.model_id] : undefined) ?? data.series[pestId] ?? [];
  const future = series.filter((p) => p.offset >= 0 && p.offset <= horizon);
  const today = series.find((p) => p.offset === 0);
  const recent = data.weather.filter((w) => !w.is_forecast).slice(-7);
  const rainSum = recent.reduce((a, w) => a + (w.rain ?? 0), 0);
  const rainDays = recent.filter((w) => (w.rain ?? 0) >= 1).length;
  const avg = (k: "tavg" | "rh" | "lwd_hours") => {
    const v = recent.map((w) => w[k]).filter((x): x is number => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const pest = pests.find((p) => p.pest_id === pestId);
  const pestName = pest?.name_ko ?? pestId;
  const phen = pest ? data.phenology?.[pest.crop] : undefined;
  const season = windowText(phen);
  const isNa = today != null && today.grade == null;
  // 모델별 오늘 값(기본 모델은 series, 추가 모델은 series_by_model)
  const todayOf = (m: ModelLite) => (m.is_default ? data.series[pestId] : data.series_by_model?.[m.model_id])?.find((p) => p.offset === 0);
  const validated = models.filter((m) => m.perf && !m.demo_only).map((m) => ({ m, t: todayOf(m) })).filter((x) => x.t && x.t.index != null);
  const best = [...validated].sort((a, b) => (b.m.perf!.auc - a.m.perf!.auc) || (b.m.type === "E" ? 1 : 0) - (a.m.type === "E" ? 1 : 0))[0];
  const nAlert = validated.filter((x) => (x.t!.index ?? 0) >= 50).length;
  const nWatch = validated.filter((x) => (x.t!.index ?? 0) >= 25 && (x.t!.index ?? 0) < 50).length;
  const selected = model ?? models.find((m) => m.is_default);
  const surveyRef = ((today?.inputs?.survey_ref ?? validated.map((x) => x.t!.inputs?.survey_ref).find(Boolean)) ?? null) as SurveyRef | null;
  const surveyMissing = today?.inputs?.survey_missing === true;

  const wx = [
    { k: "강우", v: `${rainSum.toFixed(1)}`, u: "mm", sub: `${rainDays}일` },
    { k: "평균기온", v: avg("tavg")?.toFixed(1) ?? "-", u: "℃" },
    { k: "평균습도", v: avg("rh")?.toFixed(0) ?? "-", u: "%" },
    { k: "잎젖음(추정)", v: avg("lwd_hours")?.toFixed(1) ?? "-", u: "h/일" },
  ];

  return (
    <div className="space-y-5 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-lg font-bold tracking-tight text-slate-900">{data.spot.name}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
            {data.spot.sigungu}
            <span className="text-slate-300">·</span>
            <span className="font-mono text-[11px] text-slate-400">{data.spot.spot_code}</span>
            {data.missing_rate > 0.3 && <span className="chip">자료 부족</span>}
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="패널 닫기">
            <Icon name="close" />
          </button>
        )}
      </div>

      {today && !isNa && today.index != null && (
        <section className="rounded-xl border border-brand-100 bg-brand-50/50 p-4" aria-label="한눈에 보는 안내">
          <div className="text-xs font-semibold text-brand-800">한눈에 보는 안내</div>
          <div className="mt-2 space-y-1.5 text-[13px] leading-relaxed text-slate-700">
            <p>
              오늘 {pestName} 위험은 <b className="text-slate-900">{today.grade}</b>(위험지수 {Math.round(today.index)})
              {selected && models.length > 1 && <span className="text-slate-500"> — {selected.label} 기준</span>}입니다.
              {selected && models.length > 1 && !selected.perf && <span className="text-amber-700"> 이 모델은 아직 실측 예찰로 검증되지 않았어요.</span>}
            </p>
            {validated.length >= 2 && (
              <p>
                검증된 모델 {validated.length}개 중 <b>{nAlert}개</b>가 주의보 이상, {nWatch}개가 예보, {validated.length - nAlert - nWatch}개가 정상으로 봅니다.
                {best && best.m.model_id !== selected?.model_id && (
                  <>
                    {" "}가장 정확한 <b>{best.m.label}</b>({perfText(best.m.perf)})의 판단은 <b>{gradeOf(best.t!.index ?? 0)}</b>({Math.round(best.t!.index ?? 0)})입니다.
                  </>
                )}
              </p>
            )}
            {recent.length > 0 && (
              <p className="text-slate-600">
                최근 7일 강수 {rainSum.toFixed(0)}mm({rainDays}일), 평균 잎젖음 {avg("lwd_hours")?.toFixed(1) ?? "-"}시간, 평균기온 {avg("tavg")?.toFixed(1) ?? "-"}℃.
                {surveyRef && (
                  <>
                    {" "}가까운 예찰은 {surveyRef.sigungu.split(" ").slice(-1)[0]} {surveyRef.date.slice(5).replace("-", "/")} 피해과율 {surveyRef.value}%
                    {surveyRef.distance_km > 0 ? `(약 ${Math.round(surveyRef.distance_km)}km 떨어진 시군)` : ""}입니다.
                  </>
                )}
              </p>
            )}
            {today.grade && ADVICE[today.grade] && <p className="font-medium text-slate-800">{ADVICE[today.grade]}</p>}
          </div>
        </section>
      )}

      <div className="rounded-xl bg-slate-50 p-4">
        <div className="text-xs font-medium text-slate-500">
          {pestName}
          {model && <span className="ml-1 rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700">{model.label}</span>} · 오늘
        </div>
        <div className="mt-2">{today ? <RiskBadge grade={today.grade} index={today.index} na={today.na_reason} size="lg" /> : <span className="text-slate-500">예측 없음</span>}</div>
        {isNa && today?.na_reason && <p className="mt-3 text-xs leading-relaxed text-slate-600">{NA_REASONS[today.na_reason].long(pest?.crop_ko ?? "이 작물")}</p>}
        {season && <p className="mt-2 text-xs text-slate-500">재배 기간 {season}</p>}
        {!isNa && surveyMissing && <p className="mt-2 text-xs text-amber-700">예찰 자료를 받지 못해 기상만으로 계산했습니다.</p>}
        {future.length > 0 && future.some((p) => p.index != null) && (
          <div className="mt-4 border-t border-slate-200/70 pt-3">
            <div className="flex items-baseline justify-between text-[11px] text-slate-400">
              <span className="font-medium text-slate-500">{horizon}일 추이</span>
              <span>점선은 예측</span>
            </div>
            <div className="mt-1.5">
              <Sparkline values={future.map((p) => p.index)} width={280} height={52} fluid />
            </div>
            <div className="flex justify-between text-[10px] text-slate-400">
              <span>오늘</span>
              <span>+{horizon}일</span>
            </div>
          </div>
        )}
      </div>

      {recent.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-slate-500">최근 7일 입력 기상</div>
          <dl className="mt-2 grid grid-cols-2 gap-2">
            {wx.map((w) => (
              <div key={w.k} className="rounded-xl border border-slate-100 px-3 py-2">
                <dt className="text-[11px] text-slate-400">{w.k}</dt>
                <dd className="num mt-0.5 font-semibold text-slate-900">
                  {w.v}
                  <span className="ml-0.5 text-xs font-normal text-slate-400">{w.u}</span>
                  {w.sub && <span className="ml-1 text-xs font-normal text-slate-400">· {w.sub}</span>}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <div>
        <div className="text-xs font-semibold text-slate-500">이 지점의 다른 병해충 · 오늘</div>
        <ul className="mt-1.5 divide-y divide-slate-100">
          {pests
            .filter((p) => p.pest_id !== pestId && data.series[p.pest_id])
            .map((p) => {
              const t = data.series[p.pest_id].find((x) => x.offset === 0);
              return (
                <li key={p.pest_id} className="flex items-center justify-between gap-2 py-2">
                  <Link href={`/map?crop=${p.crop}&pest=${p.pest_id}&spot=${code}`} className="truncate text-slate-700 hover:text-brand-700">
                    {pestFullName(p.crop_ko, p.name_ko)}
                  </Link>
                  {t && <RiskBadge grade={t.grade} index={t.index} na={t.na_reason} size="sm" />}
                </li>
              );
            })}
        </ul>
      </div>

      <div className="flex gap-2">
        <Link href={`/pests/${pestId}?spot=${code}`} className="btn-primary btn-sm flex-1">
          상세 보기
        </Link>
        <Link href={`/farm?spot=${code}`} className="btn-secondary btn-sm flex-1">
          <Icon name="plus" className="h-3.5 w-3.5" /> 내 농장 추가
        </Link>
      </div>
    </div>
  );
}
