"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as MLMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Icon } from "./ui";
import { fmtMD } from "@/lib/format";
import { BASEMAP_LAYERS, MAP_STYLE } from "@/lib/mapStyle";
import type { SggGeo } from "@/lib/sgg";

type View = { pest_id: string; item: string; unit: string; source: string; rounds: { date: string; rows: [string, number][] }[] };
export type ExplorerPest = { pest_id: string; name_ko: string; crop_ko: string };

const NONE = "#e2e8f0";
// 조사값(피해율 %) → 색: 0 = 옅은 회색, 0 초과는 로그 눈금으로 노랑→주황→빨강
const FILL = [
  "case",
  ["<", ["get", "v"], 0],
  "rgba(0,0,0,0)",
  ["==", ["get", "v"], 0],
  "#f1f5f9",
  ["interpolate", ["linear"], ["ln", ["+", 1, ["get", "v"]]], 0.01, "#fde68a", 0.7, "#fbbf24", 1.6, "#f97316", 2.6, "#dc2626"],
] as unknown as string;

/** NCPMS 예찰 탐색: 병해충·연도·조사일을 골라 시군별 실제 조사값을 지도·표로 본다 */
export default function SurveyExplorer({ pests }: { pests: ExplorerPest[] }) {
  const [pestId, setPestId] = useState(pests[0]?.pest_id ?? "");
  const [view, setView] = useState<View | null | undefined>(undefined);
  const [year, setYear] = useState<number | null>(null);
  const [date, setDate] = useState("");
  const [geo, setGeo] = useState<SggGeo | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    setView(undefined);
    fetch(`/data/surveyview/${pestId}.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: View | null) => {
        if (!alive) return;
        setView(d);
        const last = d?.rounds[d.rounds.length - 1];
        setYear(last ? Number(last.date.slice(0, 4)) : null);
        setDate(last?.date ?? "");
      })
      .catch(() => alive && setView(null));
    return () => {
      alive = false;
    };
  }, [pestId]);

  useEffect(() => {
    fetch("/geo/sigungu.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setGeo(j));
  }, []);

  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    let cancelled = false;
    import("maplibre-gl").then((ml) => {
      if (cancelled || !ref.current) return;
      const map = new ml.Map({ container: ref.current, style: MAP_STYLE, center: [127.8, 36.1], zoom: 5.9, attributionControl: false });
      map.addControl(new ml.NavigationControl({ showCompass: false }), "top-right");
      map.addControl(new ml.AttributionControl({ compact: true, customAttribution: "시군 경계: 통계청 SGIS · vuski/admdongkor(CC BY 4.0)" }));
      map.on("load", () => {
        BASEMAP_LAYERS.satellite.forEach((id) => map.setLayoutProperty(id, "visibility", "none"));
        BASEMAP_LAYERS.street.forEach((id) => map.setLayoutProperty(id, "visibility", "visible"));
        map.addSource("sv", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({ id: "sv-fill", type: "fill", source: "sv", paint: { "fill-color": FILL, "fill-opacity": 0.85 } });
        map.addLayer({ id: "sv-line", type: "line", source: "sv", paint: { "line-color": "#94a3b8", "line-width": 0.4 } });
        const popup = new ml.Popup({ closeButton: false, closeOnClick: false, offset: 8, className: "spot-tip" });
        map.on("mousemove", "sv-fill", (e) => {
          const p = e.features?.[0]?.properties as { key: string; v: number } | undefined;
          if (!p) return;
          popup.setLngLat(e.lngLat).setHTML(`<div class="spot-tip-name">${p.key}</div><div class="spot-tip-grade">${p.v < 0 ? "조사 없음" : `${p.v}%`}</div>`).addTo(map);
        });
        map.on("mouseleave", "sv-fill", () => popup.remove());
        mapRef.current = map;
        setReady(true);
      });
    });
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  const years = useMemo(() => (view ? Array.from(new Set(view.rounds.map((r) => Number(r.date.slice(0, 4))))).sort((a, b) => b - a) : []), [view]);
  const yearRounds = useMemo(() => (view ? view.rounds.filter((r) => Number(r.date.slice(0, 4)) === year) : []), [view, year]);
  const round = yearRounds.find((r) => r.date === date) ?? yearRounds[yearRounds.length - 1];

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !geo) return;
    const vals = new Map((round?.rows ?? []).map(([k, v]) => [k, v]));
    (map.getSource("sv") as import("maplibre-gl").GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: geo.features.map((f) => ({ ...f, properties: { key: f.properties.key, v: vals.has(f.properties.key) ? vals.get(f.properties.key)! : -1 } })),
    } as GeoJSON.FeatureCollection);
  }, [round, geo, ready]);

  const rows = round?.rows ?? [];
  const occ = rows.filter(([, v]) => v > 0).length;
  const mean = rows.length ? rows.reduce((a, [, v]) => a + v, 0) / rows.length : 0;
  const pest = pests.find((p) => p.pest_id === pestId);

  return (
    <div className="space-y-4">
      <div className="card grid gap-3 p-4 sm:grid-cols-[1.4fr_1fr_1fr]">
        <label className="block">
          <span className="field-label">병해충</span>
          <select className="field" value={pestId} onChange={(e) => setPestId(e.target.value)}>
            {pests.map((p) => (
              <option key={p.pest_id} value={p.pest_id}>
                {p.crop_ko} · {p.name_ko}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="field-label">연도</span>
          <select
            className="field"
            value={year ?? ""}
            onChange={(e) => {
              const y = Number(e.target.value);
              setYear(y);
              const rs = view?.rounds.filter((r) => Number(r.date.slice(0, 4)) === y) ?? [];
              setDate(rs[rs.length - 1]?.date ?? "");
            }}
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}년
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="field-label">조사일</span>
          <select className="field" value={round?.date ?? ""} onChange={(e) => setDate(e.target.value)}>
            {yearRounds.map((r) => (
              <option key={r.date} value={r.date}>
                {fmtMD(r.date)} ({r.rows.length}개 시군)
              </option>
            ))}
          </select>
        </label>
      </div>

      {view === null && (
        <div className="card flex gap-3 p-5 text-sm">
          <Icon name="chart" className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" />
          <p className="text-slate-600">이 병해충의 예찰 자료를 아직 받지 못했어요. 매일 조금씩 받고 있어요.</p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div ref={ref} className="h-[420px] w-full sm:h-[520px]" role="img" aria-label={`${pest?.name_ko ?? ""} 예찰 조사값 지도`} />
          <div className="pointer-events-none absolute bottom-2 left-2 rounded-lg bg-white/92 px-3 py-2 text-[11px] text-slate-600 shadow-card">
            <div className="mb-1 font-semibold text-slate-700">{view?.item ?? "조사값"}</div>
            <div className="h-2 w-44 rounded-full" style={{ background: "linear-gradient(to right,#fde68a,#fbbf24,#f97316,#dc2626)" }} />
            <div className="mt-0.5 flex w-44 justify-between text-[10px] text-slate-400">
              <span>낮음</span>
              <span>높음</span>
            </div>
            <div className="mt-1 flex items-center gap-1.5">
              <span className="h-2.5 w-3 rounded-sm bg-slate-100 ring-1 ring-slate-300" /> 0%(미발생) · 흰 바탕 = 조사 없음
            </div>
          </div>
        </div>
        <aside className="card flex max-h-[520px] flex-col overflow-hidden">
          <div className="border-b border-slate-100 px-4 py-3">
            <div className="text-sm font-semibold text-slate-800">{round ? `${round.date.slice(0, 4)}.${fmtMD(round.date)} 조사` : "조사 회차 없음"}</div>
            <p className="num mt-0.5 text-xs text-slate-500">
              조사 {rows.length}개 시군 · 발생 {occ}곳({rows.length ? Math.round((occ / rows.length) * 100) : 0}%) · 평균 {mean.toFixed(2)}%
            </p>
          </div>
          <ul className="flex-1 divide-y divide-slate-100 overflow-auto text-sm">
            {rows.map(([k, v]) => (
              <li key={k} className="flex items-center justify-between px-4 py-2">
                <span className={v > 0 ? "text-slate-800" : "text-slate-400"}>{k}</span>
                <span className={`num ${v > 0 ? "font-semibold text-slate-900" : "text-slate-400"}`}>{v}%</span>
              </li>
            ))}
          </ul>
          <p className="border-t border-slate-100 px-4 py-2 text-[10px] text-slate-400">출처: {view?.source ?? "NCPMS 예찰"}</p>
        </aside>
      </div>
    </div>
  );
}
