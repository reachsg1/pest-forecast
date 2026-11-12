"use client";

import { useState } from "react";

type Site = {
  elevation: number | null;
  elevation_source: string;
  station: { name: string; altitude: number | null; distance_km: number } | null;
  lapse_dt: number | null;
  farmmap: { pnu: string; type: string; emd: string; lnm: string; year: string }[] | null;
  soil: { parcel: string; type: string; items: { name: string; value: string }[]; source: string } | null;
  note?: string;
  error?: string;
};

const clean = (v: string) => v.replace(/^(논|밭|과수상전|임지|초지)_/, "").replace(/_/g, " ");

/** 내 농장 환경: 해발·관측지점과의 기온 보정·팜맵 필지·필지 토양. 버튼을 눌렀을 때만 불러온다(외부 API 호출 절약) */
export default function FarmSite({ lat, lon, spot }: { lat: number; lon: number; spot: string }) {
  const [site, setSite] = useState<Site | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    try {
      const r = await fetch(`/api/farm/site?lat=${lat}&lon=${lon}&spot=${encodeURIComponent(spot)}`);
      setSite((await r.json()) as Site);
    } catch {
      setSite({ error: "불러오지 못했어요. 잠시 뒤 다시 시도해 주세요." } as Site);
    } finally {
      setBusy(false);
    }
  }

  if (!site)
    return (
      <div className="border-t border-slate-100 px-5 py-3">
        <button type="button" onClick={load} disabled={busy} className="link-arrow text-xs">
          {busy ? "농장 환경 불러오는 중…" : "농장 환경 보기(해발·기온 보정·필지·토양)"}
        </button>
      </div>
    );
  if (site.error) return <p className="border-t border-slate-100 px-5 py-3 text-xs text-rose-600">{site.error}</p>;

  const types = Array.from(new Set((site.farmmap ?? []).map((p) => p.type)));
  return (
    <div className="space-y-3 border-t border-slate-100 bg-slate-50/50 px-5 py-4 text-sm">
      <div className="text-xs font-semibold text-slate-500">농장 환경</div>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div className="rounded-xl bg-white px-3 py-2 ring-1 ring-inset ring-slate-100">
          <dt className="text-[11px] text-slate-400">농장 해발</dt>
          <dd className="num font-semibold text-slate-900">{site.elevation != null ? `${Math.round(site.elevation)}m` : "–"}</dd>
        </div>
        <div className="rounded-xl bg-white px-3 py-2 ring-1 ring-inset ring-slate-100">
          <dt className="text-[11px] text-slate-400">관측지점 해발</dt>
          <dd className="num font-semibold text-slate-900">{site.station?.altitude != null ? `${Math.round(site.station.altitude)}m` : "–"}</dd>
        </div>
        <div className="col-span-2 rounded-xl bg-white px-3 py-2 ring-1 ring-inset ring-slate-100 sm:col-span-1">
          <dt className="text-[11px] text-slate-400">기온 보정(고도 차)</dt>
          <dd className="num font-semibold text-slate-900">{site.lapse_dt != null ? `${site.lapse_dt > 0 ? "+" : ""}${site.lapse_dt.toFixed(1)}℃` : "–"}</dd>
        </div>
      </dl>
      {site.lapse_dt != null && Math.abs(site.lapse_dt) >= 0.3 && site.station && (
        <p className="text-xs leading-relaxed text-slate-600">
          농장이 {site.station.name} 관측지점보다 {site.lapse_dt < 0 ? "높아" : "낮아"} 기온이 평균 약 {Math.abs(site.lapse_dt).toFixed(1)}℃ {site.lapse_dt < 0 ? "낮을" : "높을"} 수 있어요(고도 100m당 0.65℃). 위험도는 관측지점 기상으로 계산한 값이에요.
        </p>
      )}
      {site.farmmap && (
        <p className="text-xs text-slate-600">
          <b className="font-semibold text-slate-700">주변 농경지(팜맵):</b> {types.length ? types.join(" · ") : "반경 500m 안에 등록된 농경지 필지가 없어요"}
        </p>
      )}
      {site.soil ? (
        <div>
          <div className="text-xs font-semibold text-slate-700">
            토양 <span className="font-normal text-slate-400">· {site.soil.parcel}({site.soil.type})</span>
          </div>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {site.soil.items.map((it) => (
              <li key={it.name} className="rounded-lg bg-white px-2 py-1 text-[11px] ring-1 ring-inset ring-slate-100">
                <span className="text-slate-400">{it.name}</span> <b className="font-medium text-slate-700">{clean(it.value)}</b>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        site.farmmap && <p className="text-xs text-slate-400">근처 필지의 토양 정보가 없어요(시가지·미조사 지역 등).</p>
      )}
      {site.note && <p className="text-xs text-amber-700">{site.note}</p>}
      <p className="text-[10px] leading-relaxed text-slate-400">
        출처: {site.elevation_source} · 팜맵(농림축산식품부) · {site.soil?.source ?? "농촌진흥청 토양특성 상세정보"}. 조회 결과는 저장하지 않아요.
      </p>
    </div>
  );
}
