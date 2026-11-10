"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import RiskBadge from "./RiskBadge";
import Sparkline from "./Sparkline";
import type { SpotFile } from "@/lib/types";

type PestLite = { pest_id: string; name_ko: string; crop: string; crop_ko: string };

export default function SpotPanel({ code, pestId, pests, horizon, onClose }: { code: string; pestId: string; pests: PestLite[]; horizon: number; onClose?: () => void }) {
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
  if (!data) return <p className="text-sm text-gray-500">불러오는 중…</p>;

  const series = data.series[pestId] ?? [];
  const future = series.filter((p) => p.offset >= 0 && p.offset <= horizon);
  const today = series.find((p) => p.offset === 0);
  const recent = data.weather.filter((w) => !w.is_forecast).slice(-7);
  const rainSum = recent.reduce((a, w) => a + (w.rain ?? 0), 0);
  const rainDays = recent.filter((w) => (w.rain ?? 0) >= 1).length;
  const avg = (k: "tavg" | "rh" | "lwd_hours") => {
    const v = recent.map((w) => w[k]).filter((x): x is number => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const pestName = pests.find((p) => p.pest_id === pestId)?.name_ko ?? pestId;

  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-base font-bold">{data.spot.name}</div>
          <div className="text-xs text-gray-600">
            {data.spot.sigungu} · {data.spot.spot_code}
            {data.missing_rate > 0.3 && <span className="ml-1 rounded bg-gray-100 px-1 text-gray-700">자료 부족</span>}
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} className="rounded border px-2 py-0.5 text-xs" aria-label="패널 닫기">
            닫기
          </button>
        )}
      </div>

      <div>
        <div className="text-xs text-gray-600">{pestName} · 오늘</div>
        {today ? <RiskBadge grade={today.grade} index={today.index} size="lg" /> : <span className="text-gray-500">예측 없음</span>}
      </div>

      {future.length > 0 && (
        <div>
          <div className="text-xs font-semibold">위험지수 {horizon}일 추이 (예측은 점선)</div>
          <Sparkline values={future.map((p) => p.index)} width={280} height={56} />
          <div className="flex justify-between text-[10px] text-gray-500">
            <span>오늘</span>
            <span>+{horizon}일</span>
          </div>
        </div>
      )}

      {recent.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 rounded bg-gray-50 p-2 text-xs">
          <dt className="col-span-2 font-semibold">최근 7일 입력 기상</dt>
          <dt className="text-gray-600">강우량 · 강우일</dt>
          <dd className="tabular-nums">
            {rainSum.toFixed(1)} mm · {rainDays}일
          </dd>
          <dt className="text-gray-600">평균기온</dt>
          <dd className="tabular-nums">{avg("tavg")?.toFixed(1) ?? "-"} ℃</dd>
          <dt className="text-gray-600">평균습도</dt>
          <dd className="tabular-nums">{avg("rh")?.toFixed(0) ?? "-"} %</dd>
          <dt className="text-gray-600">잎젖음(추정)</dt>
          <dd className="tabular-nums">{avg("lwd_hours")?.toFixed(1) ?? "-"} h/일</dd>
        </dl>
      )}

      <div>
        <div className="text-xs font-semibold">이 지점의 다른 병해충 (오늘)</div>
        <ul className="mt-1 space-y-1">
          {pests
            .filter((p) => p.pest_id !== pestId && data.series[p.pest_id])
            .map((p) => {
              const t = data.series[p.pest_id].find((x) => x.offset === 0);
              return (
                <li key={p.pest_id} className="flex items-center justify-between">
                  <Link href={`/map?crop=${p.crop}&pest=${p.pest_id}&spot=${code}`} className="hover:underline">
                    {p.crop_ko} {p.name_ko}
                  </Link>
                  {t && <RiskBadge grade={t.grade} index={t.index} size="sm" />}
                </li>
              );
            })}
        </ul>
      </div>

      <div className="flex gap-2 pt-1">
        <Link href={`/pests/${pestId}?spot=${code}`} className="rounded bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark">
          상세 보기
        </Link>
        <Link href={`/farm?spot=${code}`} className="rounded border px-3 py-1.5 text-xs hover:bg-gray-50">
          내 농장 추가
        </Link>
      </div>
    </div>
  );
}
