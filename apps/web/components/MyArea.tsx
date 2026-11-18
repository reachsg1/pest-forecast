"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import RiskBadge from "./RiskBadge";
import { gradeOf, gradeRank } from "@/lib/grades";
import type { Grade, Spot, SpotFile } from "@/lib/types";

/**
 * 히어로 '내 지역' 상자: 등록한 농장이 있으면 그 농장, 없으면 '내 위치로 보기'(가장 가까운 관측지점).
 * 위치는 브라우저에서만 쓰고 서버로 보내지 않는다.
 */
type PestLite = { pest_id: string; name_ko: string; crop: string; crop_ko: string };
type Farm = { id: string; name: string; crop: string; lat: number; lon: number; spot_code: string; distance_km: number };
const FARM_KEY = "pest-forecast.farms.v1";

type Row = { pest: PestLite; today: Grade | null; todayIdx: number | null; peak: Grade | null; peakDay: number | null; na: boolean };

function rowsFor(file: SpotFile, pests: PestLite[], crop?: string): Row[] {
  return pests
    .filter((p) => !crop || p.crop === crop)
    .map((p) => {
      const s = file.series[p.pest_id] ?? [];
      const t = s.find((x) => x.offset === 0);
      let peak: number | null = null;
      let peakDay: number | null = null;
      for (const x of s) if (x.offset > 0 && x.offset <= 7 && x.index != null && (peak == null || x.index > peak)) [peak, peakDay] = [x.index, x.offset];
      return { pest: p, today: t?.index != null ? gradeOf(t.index) : null, todayIdx: t?.index ?? null, peak: peak != null ? gradeOf(peak) : null, peakDay, na: t?.index == null };
    })
    .sort((a, b) => gradeRank(b.today) - gradeRank(a.today) || (b.todayIdx ?? -1) - (a.todayIdx ?? -1));
}

function km(a: number, b: number, c: number, d: number) {
  const R = 6371;
  const r = (x: number) => (x * Math.PI) / 180;
  const h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export default function MyArea({ pests }: { pests: PestLite[] }) {
  const [farm, setFarm] = useState<Farm | null | undefined>(undefined);
  const [place, setPlace] = useState<{ name: string; dist: number; code: string } | null>(null);
  const [file, setFile] = useState<SpotFile | null>(null);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    try {
      const fs = JSON.parse(localStorage.getItem(FARM_KEY) ?? "[]") as Farm[];
      setFarm(fs[0] ?? null);
    } catch {
      setFarm(null);
    }
  }, []);

  useEffect(() => {
    const code = farm?.spot_code ?? place?.code;
    if (!code) return;
    fetch(`/data/spot/${code}.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setFile)
      .catch(() => setFile(null));
  }, [farm, place]);

  const locate = () => {
    if (!navigator.geolocation) return setMsg("이 브라우저는 위치를 지원하지 않아요.");
    setMsg("위치를 찾는 중…");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: la, longitude: lo } = pos.coords;
        const spots = (await fetch("/data/spots.json").then((r) => r.json())) as Spot[];
        let best: { s: Spot; d: number } | null = null;
        for (const s of spots) {
          if (s.lat == null || s.lon == null) continue;
          const d = km(la, lo, s.lat, s.lon);
          if (!best || d < best.d) best = { s, d };
        }
        if (!best) return setMsg("가까운 관측지점을 찾지 못했어요.");
        setMsg("");
        setPlace({ name: best.s.name, dist: Math.round(best.d), code: best.s.spot_code });
      },
      () => setMsg("위치 권한이 없어서 찾지 못했어요. 내 농장에서 주소로 등록할 수 있어요."),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    );
  };

  if (farm === undefined) return <div className="glass-tile h-[132px] animate-pulse" aria-hidden="true" />;

  const title = farm ? farm.name : place ? `${place.name} 부근` : null;
  const rows = file ? rowsFor(file, pests, farm?.crop).slice(0, 3) : [];
  const allNa = rows.length > 0 && rows.every((r) => r.na);

  return (
    <div className="glass-tile p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-emerald-300" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21Zm0-9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
          </svg>
          <span className="truncate">{title ? `내 지역 · ${title}` : "우리 동네는 괜찮을까?"}</span>
        </div>
        {farm ? (
          <Link href="/farm" className="shrink-0 text-xs text-white/60 hover:text-white">
            내 농장 →
          </Link>
        ) : place ? (
          <span className="num shrink-0 text-xs text-white/50">관측지점 {place.dist}km</span>
        ) : null}
      </div>

      {!title && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <button type="button" onClick={locate} className="btn-light px-3 py-1.5 text-sm">
            내 위치로 보기
          </button>
          <Link href="/farm" className="btn-glass px-3 py-1.5 text-sm">
            주소로 농장 등록
          </Link>
          {msg && <p className="w-full text-xs text-white/60">{msg}</p>}
          {!msg && <p className="w-full text-xs text-white/45">위치는 이 기기에서만 쓰고 저장하지 않아요.</p>}
        </div>
      )}

      {title && !file && <p className="mt-3 text-xs text-white/50">불러오는 중…</p>}

      {title && file && (
        <>
          {allNa ? (
            <p className="mt-2.5 text-sm text-white/70">지금은 이 지역 {farm ? pests.find((p) => p.crop === farm.crop)?.crop_ko : ""} 재배 시기가 아니어서 위험도를 쉬고 있어요.</p>
          ) : (
            <ul className="mt-2.5 space-y-1.5">
              {rows
                .filter((r) => !r.na)
                .map((r) => (
                  <li key={r.pest.pest_id} className="flex items-center justify-between gap-2 text-sm">
                    <Link href={`/pests/${r.pest.pest_id}`} className="min-w-0 truncate text-white/85 hover:text-white">
                      <span className="text-white/50">{r.pest.crop_ko}</span> {r.pest.name_ko.replace(r.pest.crop_ko, "").trim() || r.pest.name_ko}
                    </Link>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {r.peak && gradeRank(r.peak) > gradeRank(r.today) && <span className="num text-[11px] text-amber-200">{r.peakDay}일 뒤 {r.peak}</span>}
                      <RiskBadge grade={r.today} size="sm" />
                    </span>
                  </li>
                ))}
            </ul>
          )}
          {!farm && (
            <p className="mt-2 text-[11px] text-white/45">
              작물을 골라 계속 보려면{" "}
              <Link href={`/farm?spot=${place?.code}`} className="underline hover:text-white">
                내 농장에 등록
              </Link>
              하세요.
            </p>
          )}
        </>
      )}
    </div>
  );
}
