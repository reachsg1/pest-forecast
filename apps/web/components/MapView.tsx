"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Map as MLMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import RiskBadge from "./RiskBadge";
import SpotPanel from "./SpotPanel";
import { GRADES, gradeOf, gradeRank } from "@/lib/grades";
import type { Grade, RiskFile, RiskSpotEntry, Spot } from "@/lib/types";

type PestLite = { pest_id: string; name_ko: string; crop: string; crop_ko: string; horizon_days: number };

const MAP_STYLE = {
  version: 8 as const,
  sources: {
    osm: {
      type: "raster" as const,
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [{ id: "osm", type: "raster" as const, source: "osm" }],
};

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
  const offset = Math.max(0, Math.min(horizon, Number(sp.get("d") ?? 0) || 0));
  const selected = sp.get("spot") ?? "";

  const [risk, setRisk] = useState<RiskFile | null>(null);
  const [loading, setLoading] = useState(false);
  const mapRef = useRef<MLMap | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [mapReady, setMapReady] = useState(false);

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

  // 병해충 선택이 바뀌면 지도용 데이터 로드
  useEffect(() => {
    if (!pestId) return;
    let alive = true;
    setLoading(true);
    fetch(`/data/risk/${pestId}.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => alive && setRisk(j))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [pestId]);

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
      map.addControl(new ml.AttributionControl({ compact: true }));
      map.on("load", () => {
        map.addSource("spots", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({
          id: "spots-circle",
          type: "circle",
          source: "spots",
          paint: {
            "circle-radius": ["match", ["get", "rank"], 3, 11, 2, 9, 1, 7, 5],
            "circle-color": ["match", ["get", "grade"], "경보", GRADES[3].color, "주의보", GRADES[2].color, "예보", GRADES[1].color, GRADES[0].color],
            "circle-opacity": 0.85,
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": ["case", ["get", "selected"], 3, 1.2],
          },
        });
        map.addLayer({
          id: "spots-label",
          type: "symbol",
          source: "spots",
          minzoom: 7.5,
          layout: { "text-field": ["get", "name"], "text-size": 11, "text-offset": [0, 1.4], "text-anchor": "top" },
          paint: { "text-halo-color": "#fff", "text-halo-width": 1.2 },
        });
        map.on("click", "spots-circle", (e) => {
          const f = e.features?.[0];
          if (f) setParamsRef.current({ spot: String(f.properties?.spot_code ?? "") });
        });
        map.on("mouseenter", "spots-circle", () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", "spots-circle", () => (map.getCanvas().style.cursor = ""));
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
    if (!risk) return [] as (RiskSpotEntry & { index: number; grade: Grade })[];
    return risk.spots.map((s) => {
      const idx = s.index_by_offset[offset] ?? s.index_today;
      return { ...s, index: idx, grade: gradeOf(idx) };
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
          properties: { spot_code: e.spot_code, name: e.name, grade: e.grade, index: e.index, rank: gradeRank(e.grade), selected: e.spot_code === selected },
        })),
    });
  }, [entries, selected, mapReady]);

  const pestName = pests.find((p) => p.pest_id === pestId)?.name_ko ?? "";
  const counts = GRADES.map((g) => ({ ...g, n: entries.filter((e) => e.grade === g.name).length }));

  return (
    <div className="space-y-3">
      {/* 필터 바 */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-white p-2 text-sm" role="group" aria-label="예측 조건">
        <label className="flex items-center gap-1">
          <span className="text-gray-600">작물</span>
          <select className="rounded border px-2 py-1" value={crop} onChange={(e) => setParams({ crop: e.target.value, pest: null, spot: null })}>
            {crops.map((c) => (
              <option key={c} value={c}>
                {pests.find((p) => p.crop === c)?.crop_ko ?? c}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          <span className="text-gray-600">병해충</span>
          <select className="rounded border px-2 py-1" value={pestId} onChange={(e) => setParams({ pest: e.target.value })}>
            {cropPests.map((p) => (
              <option key={p.pest_id} value={p.pest_id}>
                {p.name_ko}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-1" role="radiogroup" aria-label="전망">
          <span className="text-gray-600">전망</span>
          {[0, 3, 7, 10].filter((d) => d <= horizon).map((d) => (
            <button
              key={d}
              role="radio"
              aria-checked={offset === d}
              onClick={() => setParams({ d: String(d) })}
              className={`rounded-full px-3 py-1 ${offset === d ? "bg-brand text-white" : "border bg-white hover:bg-gray-50"}`}
            >
              {d === 0 ? "오늘" : `+${d}일`}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1">
          <span className="text-gray-600">날짜</span>
          <input
            type="range"
            min={0}
            max={horizon}
            value={offset}
            onChange={(e) => setParams({ d: e.target.value })}
            aria-valuetext={addDays(issuedDate, offset)}
            className="w-28"
          />
          <span className="tabular-nums">{addDays(issuedDate, offset)}</span>
        </label>
        <button
          className="ml-auto rounded border px-3 py-1 hover:bg-gray-50"
          onClick={() => navigator.clipboard?.writeText(window.location.href)}
          title="현재 조건이 담긴 링크를 복사"
        >
          링크 공유
        </button>
      </div>

      {/* 지도 + 패널 */}
      <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
        <div className="relative h-[60vh] min-h-[420px] overflow-hidden rounded-lg border bg-gray-100">
          <div ref={containerRef} className="h-full w-full" aria-label={`${pestName} 위험도 지도`} role="application" />
          {loading && <div className="absolute inset-x-0 top-0 bg-white/80 p-2 text-center text-xs">불러오는 중…</div>}
          <div className="absolute bottom-2 left-2 rounded-lg border bg-white/95 p-2 text-xs shadow" aria-label="범례">
            <div className="mb-1 font-semibold">{pestName} · {offset === 0 ? "오늘" : `+${offset}일`}</div>
            <ul className="flex gap-3">
              {counts.map((g) => (
                <li key={g.name} className="flex items-center gap-1">
                  <span className="inline-block rounded-full" style={{ width: 8 + gradeRank(g.name) * 3, height: 8 + gradeRank(g.name) * 3, background: g.color }} aria-hidden="true" />
                  {g.name} <b>{g.n}</b>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <aside className="rounded-lg border bg-white p-3" aria-label="선택 지점 정보">
          {selected ? (
            <SpotPanel code={selected} pestId={pestId} pests={pests} horizon={horizon} onClose={() => setParams({ spot: null })} />
          ) : (
            <div className="text-sm text-gray-600">
              <p className="font-semibold text-gray-800">지점을 선택하세요</p>
              <p className="mt-1">지도의 원을 클릭하면 위험지수 추이, 입력 기상, 다른 병해충 등급을 볼 수 있습니다.</p>
              <p className="mt-3 text-xs">원이 클수록·붉을수록 위험이 높습니다. 회색은 정상입니다.</p>
            </div>
          )}
        </aside>
      </div>

      {/* 접근성 대체 표 */}
      <details className="rounded-lg border bg-white p-3">
        <summary className="cursor-pointer text-sm font-semibold">지점별 위험도 표 (지도의 대체 자료) · {entries.length}개 지점</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">
              {pestName} {addDays(issuedDate, offset)} 기준 지점별 위험도
            </caption>
            <thead>
              <tr className="border-b text-left text-xs text-gray-600">
                <th className="py-1 pr-2">지점</th>
                <th className="py-1 pr-2">시군</th>
                <th className="py-1 pr-2">등급</th>
                <th className="py-1 pr-2">지수</th>
                <th className="py-1 pr-2">7일 최대</th>
                <th className="py-1 pr-2">10일 최대</th>
                <th className="py-1 pr-2">자료</th>
              </tr>
            </thead>
            <tbody>
              {entries
                .slice()
                .sort((a, b) => b.index - a.index)
                .map((e) => (
                  <tr key={e.spot_code} className={`border-b ${e.spot_code === selected ? "bg-brand-light" : ""}`}>
                    <td className="py-1 pr-2">
                      <button className="underline" onClick={() => setParams({ spot: e.spot_code })}>
                        {e.name}
                      </button>
                    </td>
                    <td className="py-1 pr-2 text-gray-600">{e.sigungu}</td>
                    <td className="py-1 pr-2">
                      <RiskBadge grade={e.grade} size="sm" />
                    </td>
                    <td className="py-1 pr-2 tabular-nums">{Math.round(e.index)}</td>
                    <td className="py-1 pr-2 tabular-nums">{Math.round(e.max_index_7d)}</td>
                    <td className="py-1 pr-2 tabular-nums">{Math.round(e.max_index_10d)}</td>
                    <td className="py-1 pr-2 text-xs text-gray-500">{e.data_poor ? "자료 부족" : ""}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex gap-3 text-xs">
          <a className="underline" href={`/api/v1/risk?pest=${pestId}&offset=${offset}&format=csv`}>
            CSV 다운로드
          </a>
          <Link className="underline" href={`/pests/${pestId}`}>
            {pestName} 상세·예측 근거
          </Link>
        </div>
      </details>
    </div>
  );
}
