"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as MLMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { GRADES, gradeOf } from "@/lib/grades";
import { BASEMAP_LAYERS, MAP_STYLE, type Basemap } from "@/lib/mapStyle";

export type MapRow = { sigungu: string; loc: [number, number] | null; pred: number; actual: number; verdict: "hit" | "correct_neg" | "miss" | "false_alarm" };
export type ColorMode = "pred" | "verdict";

export const VERDICT_COLOR: Record<MapRow["verdict"], string> = {
  hit: "#10b981",
  correct_neg: "#cbd5e1",
  miss: "#e11d48",
  false_alarm: "#f59e0b",
};
const VERDICT_LABEL: Record<MapRow["verdict"], string> = { hit: "맞힘(발생)", correct_neg: "맞힘(미발생)", miss: "놓침", false_alarm: "헛경보" };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

/** 과거 비교 지도: 시군 대표 지점에 그날 예측(색)과 실제 발생(굵은 테두리) 또는 판정(색)을 표시한다. */
export default function BacktestMap({ rows, mode, unit = "피해과율" }: { rows: MapRow[]; mode: ColorMode; unit?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const [basemap, setBasemap] = useState<Basemap>("street");

  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    let cancelled = false;
    import("maplibre-gl").then((ml) => {
      if (cancelled || !ref.current) return;
      const map = new ml.Map({ container: ref.current, style: MAP_STYLE, center: [127.8, 36.1], zoom: 5.9, attributionControl: false });
      map.addControl(new ml.NavigationControl({ showCompass: false }), "top-right");
      map.addControl(new ml.AttributionControl({ compact: true }));
      map.on("load", () => {
        map.addSource("bt", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({
          id: "bt-circle",
          type: "circle",
          source: "bt",
          paint: {
            "circle-radius": ["case", ["get", "occurred"], 9, 7] as unknown as number,
            "circle-color": ["get", "color"] as unknown as string,
            "circle-opacity": 0.95,
            "circle-stroke-color": ["get", "stroke"] as unknown as string,
            "circle-stroke-width": ["get", "strokeW"] as unknown as number,
          },
        });
        const popup = new ml.Popup({ closeButton: false, closeOnClick: false, offset: 12, className: "spot-tip" });
        map.on("mousemove", "bt-circle", (e) => {
          const f = e.features?.[0];
          if (!f) return;
          map.getCanvas().style.cursor = "pointer";
          const p = f.properties as { name: string; pred: number; grade: string; actual: number; verdict: MapRow["verdict"] };
          const geom = f.geometry as unknown as { coordinates: [number, number] };
          popup
            .setLngLat(geom.coordinates)
            .setHTML(
              `<div class="spot-tip-name">${esc(p.name)}</div><div class="spot-tip-grade">예측 ${esc(p.grade)} <b>${p.pred}</b> · 실제 ${p.actual}%</div><div class="spot-tip-grade">${VERDICT_LABEL[p.verdict]}</div>`,
            )
            .addTo(map);
        });
        map.on("mouseleave", "bt-circle", () => {
          map.getCanvas().style.cursor = "";
          popup.remove();
        });
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

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (Object.keys(BASEMAP_LAYERS) as Basemap[]).forEach((b) =>
      BASEMAP_LAYERS[b].forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, "visibility", b === basemap ? "visible" : "none")),
    );
  }, [basemap, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = map.getSource("bt") as import("maplibre-gl").GeoJSONSource | undefined;
    if (!src) return;
    const dark = basemap === "satellite" ? "#ffffff" : "#0f172a";
    src.setData({
      type: "FeatureCollection",
      features: rows
        .filter((r) => r.loc)
        // 발생한 곳을 위에 그린다
        .sort((a, b) => Number(a.actual > 0) - Number(b.actual > 0))
        .map((r) => {
          const g = gradeOf(r.pred);
          const occurred = r.actual > 0;
          const color = mode === "pred" ? GRADES.find((x) => x.name === g)!.color : VERDICT_COLOR[r.verdict];
          return {
            type: "Feature" as const,
            geometry: { type: "Point" as const, coordinates: [r.loc![1], r.loc![0]] },
            properties: {
              name: r.sigungu,
              pred: r.pred,
              grade: g,
              actual: r.actual,
              verdict: r.verdict,
              occurred,
              color,
              stroke: mode === "pred" && occurred ? dark : "#ffffff",
              strokeW: mode === "pred" && occurred ? 3 : 1.5,
            },
          };
        }),
    });
  }, [rows, mode, ready, basemap]);

  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-200">
      <div ref={ref} className="h-[380px] w-full sm:h-[460px]" role="img" aria-label="과거 예찰 회차의 시군별 예측과 실제 지도" />
      {/* 범례 */}
      <div className="pointer-events-none absolute bottom-2 left-2 max-w-[calc(100%-1rem)] rounded-lg bg-white/92 px-3 py-2 text-[11px] text-slate-600 shadow-card backdrop-blur">
        {mode === "pred" ? (
          <>
            <div className="mb-1 font-semibold text-slate-700">색 = 그날 예측 등급</div>
            <div className="flex flex-wrap gap-x-2.5 gap-y-1">
              {GRADES.slice()
                .reverse()
                .map((g) => (
                  <span key={g.name} className="inline-flex items-center gap-1">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: g.color }} />
                    {g.icon} {g.name}
                  </span>
                ))}
            </div>
            <div className="mt-1 flex items-center gap-1">
              <span className="h-3 w-3 rounded-full border-[3px] border-slate-900 bg-white" /> 굵은 테두리 = 실제 발생({unit} 0 초과)
            </div>
          </>
        ) : (
          <>
            <div className="mb-1 font-semibold text-slate-700">색 = 판정</div>
            <div className="flex flex-wrap gap-x-2.5 gap-y-1">
              {(Object.keys(VERDICT_COLOR) as MapRow["verdict"][]).map((v) => (
                <span key={v} className="inline-flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: VERDICT_COLOR[v] }} />
                  {VERDICT_LABEL[v]}
                </span>
              ))}
            </div>
          </>
        )}
      </div>
      <div className="absolute left-2 top-2 flex rounded-lg bg-white/92 p-0.5 text-[11px] shadow-card backdrop-blur" role="radiogroup" aria-label="배경지도">
        {(
          [
            ["street", "일반"],
            ["satellite", "위성"],
          ] as [Basemap, string][]
        ).map(([b, l]) => (
          <button
            key={b}
            type="button"
            role="radio"
            aria-checked={basemap === b}
            onClick={() => setBasemap(b)}
            className={`rounded-md px-2 py-1 font-medium ${basemap === b ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-800"}`}
          >
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}
