"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Map as MLMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import RiskBadge from "./RiskBadge";
import AddressSearch, { type GeoHit } from "./AddressSearch";
import SpotPanel from "./SpotPanel";
import { Icon } from "./ui";
import { GRADES, NA, TYPE_LABEL, fmtIndex, gradeOf, gradeRank, perfText } from "@/lib/grades";
import type { Grade, ModelLite, NaReason, RiskFile, RiskSpotEntry, Spot } from "@/lib/types";
import { fmtDate } from "@/lib/format";
import { BASEMAP_LAYERS, MAP_STYLE, type Basemap } from "@/lib/mapStyle";
import { SGG_FILL, SGG_GRADIENT, assignSpots, sggValues, type SggGeo } from "@/lib/sgg";

type PestLite = { pest_id: string; name_ko: string; crop: string; crop_ko: string; horizon_days: number; models: ModelLite[] };


function addDays(iso: string, n: number): string {
  if (!iso) return "";
  // UTC 기준으로 계산해야 KST 등 양의 시차에서 toISOString()이 하루 앞당겨지지 않는다
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export default function MapView({ pests, spots, horizon, issuedDate }: { pests: PestLite[]; spots: Spot[]; horizon: number; issuedDate: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const crops = useMemo(() => Array.from(new Set(pests.map((p) => p.crop))), [pests]);
  const crop = sp.get("crop") ?? pests[0]?.crop ?? "";
  const cropPests = useMemo(() => pests.filter((p) => p.crop === crop), [pests, crop]);
  const pestId = sp.get("pest") && pests.some((p) => p.pest_id === sp.get("pest")) ? (sp.get("pest") as string) : cropPests[0]?.pest_id ?? "";
  // 예측 모델: 병해충마다 여러 개일 수 있다. URL ?model= 이 이 병해충의 모델이 아니면 기본 모델.
  const pestModels = useMemo(() => pests.find((p) => p.pest_id === pestId)?.models ?? [], [pests, pestId]);
  const defaultModel = pestModels.find((m) => m.is_default) ?? pestModels[0];
  const model = pestModels.find((m) => m.model_id === sp.get("model")) ?? defaultModel;
  const modelId = model?.model_id ?? pestId;
  const offset = Math.max(0, Math.min(horizon, Number(sp.get("d") ?? 0) || 0));
  const selected = sp.get("spot") ?? "";
  // 보기: 지점(원) | 시군(경계 색)
  const view: "spot" | "sgg" = sp.get("view") === "sgg" ? "sgg" : "spot";
  const [geo, setGeo] = useState<SggGeo | null>(null);

  const [risk, setRisk] = useState<RiskFile | null>(null);
  const [loading, setLoading] = useState(false);
  const mapRef = useRef<MLMap | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [basemap, setBasemap] = useState<Basemap>("satellite");

  // 배경지도 전환: 레이어 표시만 바꾼다
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    (Object.keys(BASEMAP_LAYERS) as Basemap[]).forEach((b) =>
      BASEMAP_LAYERS[b].forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, "visibility", b === basemap ? "visible" : "none")),
    );
  }, [basemap, mapReady]);

  const setParams = useCallback(
    (patch: Record<string, string | null>) => {
      const q = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "") q.delete(k);
        else q.set(k, v);
      }
      router.replace(`/map?${q.toString()}`, { scroll: false });
    },
    [router, sp],
  );

  // 병해충·모델 선택이 바뀌면 그 모델의 지도용 데이터 로드
  // (모델별 파일 risk/models/<model_id>.json, 없으면 예전 형식 risk/<pest_id>.json)
  useEffect(() => {
    if (!pestId) return;
    let alive = true;
    setLoading(true);
    fetch(`/data/risk/models/${modelId}.json`)
      .then((r) => (r.ok ? r : fetch(`/data/risk/${pestId}.json`)))
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => alive && setRisk(j))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [pestId, modelId]);

  // 시군 경계는 시군 보기를 처음 켤 때 한 번 받는다(약 0.5MB)
  useEffect(() => {
    if (view !== "sgg" || geo) return;
    let alive = true;
    fetch("/geo/sigungu.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => alive && j && setGeo(j));
    return () => {
      alive = false;
    };
  }, [view, geo]);

  // 지도 클릭 핸들러가 항상 최신 URL 상태를 쓰도록 ref로 전달
  const setParamsRef = useRef(setParams);
  useEffect(() => {
    setParamsRef.current = setParams;
  }, [setParams]);

  // 지도 초기화 (클라이언트에서만, 1회)
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;
    import("maplibre-gl").then((ml) => {
      if (cancelled || !containerRef.current) return;
      const map = new ml.Map({ container: containerRef.current, style: MAP_STYLE, center: [127.8, 36.3], zoom: 6.2, attributionControl: false });
      map.addControl(new ml.NavigationControl({ showCompass: false }), "top-right");
      map.addControl(new ml.AttributionControl({ compact: true, customAttribution: "시군 경계: 통계청 SGIS(공공누리 1유형) · vuski/admdongkor(CC BY 4.0)" }));
      map.on("load", () => {
        // 시군 색(경계) — 지점 원 아래에 깐다
        map.addSource("sgg", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({ id: "sgg-fill", type: "fill", source: "sgg", layout: { visibility: "none" }, paint: { "fill-color": SGG_FILL, "fill-opacity": ["case", ["<", ["get", "idx"], 0], 0.45, 0.78] as unknown as number } });
        map.addLayer({ id: "sgg-line", type: "line", source: "sgg", layout: { visibility: "none" }, paint: { "line-color": "#ffffff", "line-width": ["case", ["get", "selected"], 2.5, 0.6] as unknown as number, "line-opacity": 0.9 } });
        map.addSource("spots", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        const color = ["match", ["get", "grade"], "경보", GRADES[3].color, "주의보", GRADES[2].color, "예보", GRADES[1].color, "정상", GRADES[0].color, "#ffffff"] as unknown as string;
        // 위성 위에서 잘 보이도록 등급색 은은한 번짐(halo)
        map.addLayer({
          id: "spots-halo",
          type: "circle",
          source: "spots",
          filter: [">=", ["get", "rank"], 1],
          paint: {
            "circle-radius": ["match", ["get", "rank"], 3, 24, 2, 18, 14] as unknown as number,
            "circle-color": color,
            "circle-opacity": 0.28,
            "circle-blur": 0.9,
          },
        });
        map.addLayer({
          id: "spots-circle",
          type: "circle",
          source: "spots",
          paint: {
            // rank -1 = 해당 없음: 작은 흰 원 + 회색 테두리(등급색과 섞이지 않게)
            "circle-radius": ["match", ["get", "rank"], 3, 11, 2, 9, 1, 7, -1, 5, 6],
            "circle-color": color,
            "circle-opacity": ["case", ["==", ["get", "rank"], -1], 0.9, 0.95],
            "circle-stroke-color": ["case", ["==", ["get", "rank"], -1], NA.stroke, "#ffffff"],
            "circle-stroke-width": ["case", ["get", "selected"], 3.5, 2],
          },
        });
        // 마우스를 올리면 지점명·등급 툴팁
        const popup = new ml.Popup({ closeButton: false, closeOnClick: false, offset: 14, className: "spot-tip" });
        map.on("click", "spots-circle", (e) => {
          const f = e.features?.[0];
          if (f) setParamsRef.current({ spot: String(f.properties?.spot_code ?? "") });
        });
        map.on("mousemove", "spots-circle", (e) => {
          const f = e.features?.[0];
          if (!f) return;
          map.getCanvas().style.cursor = "pointer";
          const p = f.properties as { name: string; grade: string; index: number };
          const geom = f.geometry as unknown as { coordinates: [number, number] };
          const idx = p.index >= 0 ? ` <b>${Math.round(p.index)}</b>` : "";
          popup.setLngLat(geom.coordinates).setHTML(`<div class="spot-tip-name">${p.name}</div><div class="spot-tip-grade">${p.grade}${idx}</div>`).addTo(map);
        });
        map.on("mouseleave", "spots-circle", () => {
          map.getCanvas().style.cursor = "";
          popup.remove();
        });
        map.on("click", "sgg-fill", (e) => {
          const code = e.features?.[0]?.properties?.top_code;
          if (code) setParamsRef.current({ spot: String(code) });
        });
        map.on("mousemove", "sgg-fill", (e) => {
          const f = e.features?.[0];
          if (!f) return;
          map.getCanvas().style.cursor = "pointer";
          const p = f.properties as { key: string; grade: string; idx: number; n: number; top_name: string; sub_km: number };
          const val = p.idx >= 0 ? `${p.grade} <b>${Math.round(p.idx)}</b>` : p.grade;
          const src = p.sub_km >= 0 ? `관측지점 없음 · ${p.top_name} ${p.sub_km}km 대체` : p.n > 1 ? `지점 ${p.n}곳 중 최고 · ${p.top_name}` : p.top_name;
          popup.setLngLat(e.lngLat).setHTML(`<div class="spot-tip-name">${p.key}</div><div class="spot-tip-grade">${val}</div><div class="spot-tip-grade">${src}</div>`).addTo(map);
        });
        map.on("mouseleave", "sgg-fill", () => {
          map.getCanvas().style.cursor = "";
          popup.remove();
        });
        mapRef.current = map;
        setMapReady(true);
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 데이터·전망일·선택이 바뀌면 마커 갱신
  const entries = useMemo(() => {
    if (!risk) return [] as (RiskSpotEntry & { index: number | null; grade: Grade | null; na: NaReason | null })[];
    return risk.spots.map((s) => {
      // null(해당 없음)을 오늘 값으로 대체하지 않도록 범위 안이면 그 날 값을 그대로 쓴다
      const inRange = offset < s.index_by_offset.length;
      const idx = inRange ? s.index_by_offset[offset] : s.index_today;
      const na = (inRange ? s.na_by_offset?.[offset] : s.na_today) ?? null;
      return { ...s, index: idx, grade: idx == null ? null : gradeOf(idx), na: idx == null ? na : null };
    });
  }, [risk, offset]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const src = map.getSource("spots") as import("maplibre-gl").GeoJSONSource | undefined;
    if (!src) return;
    src.setData({
      type: "FeatureCollection",
      features: entries
        .filter((e) => e.lat != null && e.lon != null)
        .map((e) => ({
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [e.lon as number, e.lat as number] },
          properties: { spot_code: e.spot_code, name: e.name, grade: e.grade ?? NA.label, index: e.index ?? -1, rank: gradeRank(e.grade), selected: e.spot_code === selected },
        })),
    });
  }, [entries, selected, mapReady]);

  // 시군 보기: 지점→시군 배정(위치 기준)은 경계·지점 목록이 바뀔 때만 다시 계산
  const assign = useMemo(() => (geo && risk ? assignSpots(geo, risk.spots) : null), [geo, risk]);
  const sggVals = useMemo(() => {
    if (!geo || !assign) return [];
    return sggValues(geo, assign, new Map(entries.map((e) => [e.spot_code, { name: e.name, index: e.index }])));
  }, [geo, assign, entries]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const sgg = view === "sgg";
    ["sgg-fill", "sgg-line"].forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, "visibility", sgg ? "visible" : "none"));
    ["spots-halo", "spots-circle"].forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, "visibility", sgg ? "none" : "visible"));
    if (!sgg || !geo) return;
    const src = map.getSource("sgg") as import("maplibre-gl").GeoJSONSource | undefined;
    const byKey = new Map(sggVals.map((v) => [v.key, v]));
    src?.setData({
      type: "FeatureCollection",
      features: geo.features.map((f) => {
        const v = byKey.get(f.properties.key);
        return {
          ...f,
          properties: {
            key: f.properties.key,
            idx: v?.idx ?? -1,
            grade: v?.grade ?? NA.label,
            n: v?.n ?? 0,
            top_code: v?.topCode ?? "",
            top_name: v?.topName ?? "",
            sub_km: v?.subKm ?? -1,
            selected: !!selected && v?.topCode === selected,
          },
        };
      }),
    } as GeoJSON.FeatureCollection);
  }, [view, geo, sggVals, selected, mapReady]);

  const pestName = pests.find((p) => p.pest_id === pestId)?.name_ko ?? "";
  const counts = GRADES.map((g) => ({ ...g, n: entries.filter((e) => e.grade === g.name).length }));
  const naCount = entries.filter((e) => e.grade == null).length;

  // 주소 검색 → 그 위치로 이동하고 가장 가까운 관측지점을 연다
  const goTo = (h: GeoHit) => {
    mapRef.current?.flyTo({ center: [h.lon, h.lat], zoom: 10.5, speed: 1.4 });
    let best: { code: string; d: number } | null = null;
    for (const s of spots) {
      if (s.lat == null || s.lon == null) continue;
      const d = (s.lat - h.lat) ** 2 + ((s.lon - h.lon) * Math.cos((h.lat * Math.PI) / 180)) ** 2;
      if (!best || d < best.d) best = { code: s.spot_code, d };
    }
    if (best) setParams({ spot: best.code });
  };

  const [copied, setCopied] = useState(false);
  const share = () => {
    navigator.clipboard?.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="space-y-4">
      {/* 지도 + 패널 */}
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="relative h-[calc(100vh-12rem)] min-h-[560px] overflow-hidden rounded-3xl bg-slate-900 shadow-lift ring-1 ring-black/5">
          <div ref={containerRef} className="h-full w-full" aria-label={`${pestName} 위험도 지도`} role="application" />

          {/* 조건 패널 (지도 위에 떠 있는 유리 패널) */}
          <div className="glass-dark absolute left-3 right-14 top-3 space-y-3 p-3.5 sm:right-auto sm:w-[380px]" role="group" aria-label="예측 조건">
            <AddressSearch dark onPick={goTo} placeholder="주소·지명으로 이동 (예: 영양군)" />
            <div className="grid grid-cols-[1fr_1.5fr] gap-2">
              <label>
                <span className="mb-1 block text-[11px] font-medium text-white/60">작물</span>
                <select className="field-glass" value={crop} onChange={(e) => setParams({ crop: e.target.value, pest: null, model: null, spot: null })}>
                  {crops.map((c) => (
                    <option key={c} value={c}>
                      {pests.find((p) => p.crop === c)?.crop_ko ?? c}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="mb-1 block text-[11px] font-medium text-white/60">병해충</span>
                <select className="field-glass" value={pestId} onChange={(e) => setParams({ pest: e.target.value, model: null })}>
                  {cropPests.map((p) => (
                    <option key={p.pest_id} value={p.pest_id}>
                      {p.name_ko}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {/* 예측 모델 선택: 모델이 2개 이상일 때만 고를 수 있고, 1개면 이름만 보여 준다 */}
            {pestModels.length > 1 ? (
              <div>
                <span className="mb-1 flex items-center justify-between text-[11px] font-medium text-white/60">
                  <span>예측 모델</span>
                  <span className="text-white/40">{pestModels.length}개</span>
                </span>
                {pestModels.length > 3 ? (
                  // 모델이 많으면 목록으로: 이름 · 알고리즘 · 시험 성능
                  <>
                    <select
                      className="field-glass"
                      aria-label="예측 모델"
                      value={modelId}
                      onChange={(e) => {
                        const m = pestModels.find((x) => x.model_id === e.target.value);
                        setParams({ model: !m || m.is_default ? null : m.model_id });
                      }}
                    >
                      {pestModels.map((m) => (
                        <option key={m.model_id} value={m.model_id}>
                          {m.label}
                          {m.is_default ? " (기본)" : ""} — {perfText(m.perf)}
                        </option>
                      ))}
                    </select>
                    {model && (
                      <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-white/60">
                        <span className="rounded bg-white/15 px-1 text-[10px] font-semibold text-white/80">{model.type}</span>
                        {TYPE_LABEL[model.type] ?? model.type}
                        <span className="text-white/30">·</span>
                        <span className={model.perf ? "text-emerald-200" : "text-amber-200"}>{perfText(model.perf)}</span>
                      </p>
                    )}
                  </>
                ) : (
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="예측 모델">
                  {pestModels.map((m) => (
                    <button
                      key={m.model_id}
                      role="radio"
                      aria-checked={m.model_id === modelId}
                      onClick={() => setParams({ model: m.is_default ? null : m.model_id })}
                      className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                        m.model_id === modelId ? "border-emerald-300/60 bg-emerald-400/20 text-white" : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
                      }`}
                    >
                      <span className="rounded bg-white/15 px-1 text-[10px] font-semibold">{m.type}</span>
                      {m.label}
                      {m.is_default && <span className="text-[10px] text-white/45">기본</span>}
                    </button>
                  ))}
                </div>
                )}
              </div>
            ) : (
              model && (
                <p className="flex items-center gap-1.5 text-[11px] text-white/50">
                  예측 모델 <span className="rounded bg-white/10 px-1.5 py-0.5 font-medium text-white/80">{model.label}</span>
                </p>
              )
            )}
            <div className="flex items-center justify-between gap-2">
              <div className="segmented-glass" role="radiogroup" aria-label="전망">
                {[0, 3, 7, 10].filter((d) => d <= horizon).map((d) => (
                  <button key={d} role="radio" aria-checked={offset === d} onClick={() => setParams({ d: String(d) })}>
                    {d === 0 ? "오늘" : `+${d}일`}
                  </button>
                ))}
              </div>
              <button className="hidden whitespace-nowrap rounded-lg px-2 py-1 text-xs font-medium text-white/70 hover:bg-white/10 hover:text-white sm:block" onClick={share} title="현재 조건이 담긴 링크를 복사">
                {copied ? "복사됨" : "링크 공유"}
              </button>
            </div>
            <label className="block">
              <span className="flex items-baseline justify-between text-[11px] text-white/60">
                <span>날짜</span>
                <span className="num text-sm font-semibold text-white">{fmtDate(addDays(issuedDate, offset))}</span>
              </span>
              <input
                type="range"
                min={0}
                max={horizon}
                value={offset}
                onChange={(e) => setParams({ d: e.target.value })}
                aria-valuetext={fmtDate(addDays(issuedDate, offset))}
                className="mt-1 h-5 w-full accent-emerald-400"
              />
            </label>
          </div>

          {/* 표시 방식: 지점 원 / 시군 색 */}
          <div className="glass-dark absolute right-3 top-[94px] flex flex-col gap-0.5 p-1 text-xs" role="radiogroup" aria-label="표시 방식">
            {(
              [
                ["spot", "지점"],
                ["sgg", "시군"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                role="radio"
                aria-checked={view === v}
                onClick={() => setParams({ view: v === "sgg" ? "sgg" : null })}
                className={`rounded-lg px-2 py-1.5 font-medium transition ${view === v ? "bg-white text-slate-900" : "text-white/70 hover:text-white"}`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* 배경지도 전환 */}
          <div className="glass-dark absolute right-3 top-[170px] flex flex-col gap-0.5 p-1 text-xs" role="radiogroup" aria-label="배경지도">
            {(
              [
                ["satellite", "위성"],
                ["street", "일반"],
              ] as [Basemap, string][]
            ).map(([b, label]) => (
              <button
                key={b}
                role="radio"
                aria-checked={basemap === b}
                onClick={() => setBasemap(b)}
                className={`rounded-lg px-2 py-1.5 font-medium transition ${basemap === b ? "bg-white text-slate-900" : "text-white/70 hover:text-white"}`}
              >
                {label}
              </button>
            ))}
          </div>

          {loading && <div className="glass-dark absolute left-1/2 top-3 -translate-x-1/2 rounded-full px-3 py-1 text-xs">불러오는 중…</div>}

          {/* 범례 */}
          <div className="glass-dark absolute bottom-9 left-3 max-w-[calc(100%-1.5rem)] px-3.5 py-2.5 text-xs sm:bottom-3 sm:max-w-[calc(100%-16rem)]" aria-label="범례">
            <div className="mb-1.5 font-semibold">
              {pestName} <span className="font-normal text-white/50">· {offset === 0 ? "오늘" : `+${offset}일`}</span>
              {pestModels.length > 1 && model && <span className="ml-1.5 rounded bg-emerald-400/20 px-1.5 py-0.5 text-[10px] font-medium text-emerald-100">{model.label}</span>}
            </div>
            {view === "sgg" ? (
              <div className="w-64 max-w-full">
                <div className="h-2.5 rounded-full" style={{ background: SGG_GRADIENT }} aria-hidden="true" />
                <div className="mt-1 grid grid-cols-4 text-[10px] text-white/70">
                  {GRADES.map((g) => (
                    <span key={g.name}>
                      {g.icon} {g.name}
                    </span>
                  ))}
                </div>
                <p className="mt-1.5 text-[10px] leading-relaxed text-white/55">
                  <span className="hidden sm:inline">시군 색 = 그 시군 지점 중 가장 높은 위험지수 · 관측지점이 없는 시군은 가장 가까운 지점 값 · </span>
                  <span className="inline-block h-2 w-3 rounded-sm bg-slate-200 align-middle" aria-hidden="true" /> 해당 없음
                  {sggVals.length > 0 && (
                    <>
                      {" "}
                      · 시군 {sggVals.length}곳 중 주의보 이상 <b className="num text-white">{sggVals.filter((v) => v.idx != null && v.idx >= 50).length}</b>
                    </>
                  )}
                </p>
              </div>
            ) : (
            <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-white/75">
              {counts.map((g) => (
                <li key={g.name} className="flex items-center gap-1.5">
                  <span className="inline-block rounded-full ring-2 ring-white/80" style={{ width: 8 + gradeRank(g.name) * 2.5, height: 8 + gradeRank(g.name) * 2.5, background: g.color }} aria-hidden="true" />
                  {g.name} <b className="num text-white">{g.n}</b>
                </li>
              ))}
              {naCount > 0 && (
                <li className="flex items-center gap-1.5 text-white/50" title="비재배지·재배 시기 아님">
                  <span className="inline-block h-2 w-2 rounded-full border-[1.5px] bg-white" style={{ borderColor: NA.stroke }} aria-hidden="true" />
                  {NA.label} <b className="num text-white/70">{naCount}</b>
                </li>
              )}
            </ul>
            )}
          </div>
        </div>
        <aside className="card p-5" aria-label="선택 지점 정보">
          {selected ? (
            <SpotPanel
              code={selected}
              pestId={pestId}
              model={pestModels.length > 1 ? model : undefined}
              models={pestModels}
              pests={pests}
              horizon={horizon}
              onClose={() => setParams({ spot: null })}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center py-10 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-50 text-brand-600">
                <Icon name="location" className="h-6 w-6" />
              </span>
              <p className="mt-4 font-semibold text-slate-800">지점을 선택하세요</p>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-500">지도의 원을 누르면 위험지수 추이, 입력 기상, 다른 병해충 등급을 볼 수 있습니다.</p>
              <p className="mt-4 text-xs leading-relaxed text-slate-400">원이 클수록·붉을수록 위험이 높습니다. 테두리만 있는 작은 흰 원은 작물을 재배하지 않거나 재배 시기가 아니어서 계산하지 않은 지점입니다.</p>
            </div>
          )}
        </aside>
      </div>

      {/* 접근성 대체 표 */}
      <details className="card group overflow-hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 text-sm font-semibold text-slate-800">
          <span>
            지점별 위험도 표 <span className="font-normal text-slate-400">· 지도의 대체 자료 · {entries.length}개 지점</span>
          </span>
          <span aria-hidden="true" className="text-slate-400 transition group-open:rotate-180">
            ▾
          </span>
        </summary>
        <div className="overflow-x-auto border-t border-slate-100">
          <table className="table-clean">
            <caption className="sr-only">
              {pestName} {fmtDate(addDays(issuedDate, offset))} 기준 지점별 위험도
            </caption>
            <thead>
              <tr>
                <th>지점</th>
                <th>시군</th>
                <th>등급</th>
                <th className="text-right">지수</th>
                <th className="text-right">7일 최대</th>
                <th className="text-right">10일 최대</th>
                <th>자료</th>
              </tr>
            </thead>
            <tbody>
              {entries
                .slice()
                .sort((a, b) => (a.index == null ? 1 : 0) - (b.index == null ? 1 : 0) || (b.index ?? 0) - (a.index ?? 0))
                .map((e) => (
                  <tr key={e.spot_code} className={e.spot_code === selected ? "bg-brand-50/60" : ""}>
                    <td>
                      <button className="font-medium text-slate-900 hover:text-brand-700" onClick={() => setParams({ spot: e.spot_code })}>
                        {e.name}
                      </button>
                    </td>
                    <td className="text-slate-500">{e.sigungu}</td>
                    <td>
                      <RiskBadge grade={e.grade} na={e.na} size="sm" />
                    </td>
                    <td className="num text-right">{fmtIndex(e.index)}</td>
                    <td className="num text-right text-slate-500">{fmtIndex(e.max_index_7d)}</td>
                    <td className="num text-right text-slate-500">{fmtIndex(e.max_index_10d)}</td>
                    <td className="text-xs text-slate-400">{e.data_poor ? "자료 부족" : ""}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div className="flex gap-4 border-t border-slate-100 px-5 py-3 text-xs">
          <a className="link-arrow text-xs" href={`/api/v1/risk?pest=${pestId}&offset=${offset}&format=csv`}>
            CSV 다운로드
          </a>
          <Link className="font-medium text-slate-500 hover:text-slate-900" href={`/pests/${pestId}`}>
            {pestName} 상세·예측 근거
          </Link>
        </div>
      </details>
    </div>
  );
}
