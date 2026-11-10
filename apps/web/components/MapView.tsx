"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Map as MLMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import RiskBadge from "./RiskBadge";
import SpotPanel from "./SpotPanel";
import { Icon } from "./ui";
import { GRADES, NA, fmtIndex, gradeOf, gradeRank } from "@/lib/grades";
import type { Grade, NaReason, RiskFile, RiskSpotEntry, Spot } from "@/lib/types";

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
            // rank -1 = 해당 없음: 작은 흰 원 + 회색 테두리(등급색과 섞이지 않게)
            "circle-radius": ["match", ["get", "rank"], 3, 11, 2, 9, 1, 7, -1, 4.5, 5],
            "circle-color": ["match", ["get", "grade"], "경보", GRADES[3].color, "주의보", GRADES[2].color, "예보", GRADES[1].color, "정상", GRADES[0].color, "#ffffff"],
            "circle-opacity": ["case", ["==", ["get", "rank"], -1], 0.95, 0.85],
            "circle-stroke-color": ["case", ["==", ["get", "rank"], -1], NA.stroke, "#ffffff"],
            "circle-stroke-width": ["case", ["get", "selected"], 3, ["==", ["get", "rank"], -1], 1.5, 1.2],
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

  const pestName = pests.find((p) => p.pest_id === pestId)?.name_ko ?? "";
  const counts = GRADES.map((g) => ({ ...g, n: entries.filter((e) => e.grade === g.name).length }));
  const naCount = entries.filter((e) => e.grade == null).length;

  const [copied, setCopied] = useState(false);
  const share = () => {
    navigator.clipboard?.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="space-y-4">
      {/* 조건 바 */}
      <div className="card flex flex-wrap items-end gap-x-5 gap-y-3 p-4" role="group" aria-label="예측 조건">
        <label className="min-w-[110px]">
          <span className="field-label">작물</span>
          <select className="field py-1.5" value={crop} onChange={(e) => setParams({ crop: e.target.value, pest: null, spot: null })}>
            {crops.map((c) => (
              <option key={c} value={c}>
                {pests.find((p) => p.crop === c)?.crop_ko ?? c}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-[170px]">
          <span className="field-label">병해충</span>
          <select className="field py-1.5" value={pestId} onChange={(e) => setParams({ pest: e.target.value })}>
            {cropPests.map((p) => (
              <option key={p.pest_id} value={p.pest_id}>
                {p.name_ko}
              </option>
            ))}
          </select>
        </label>
        <div>
          <span className="field-label" id="horizon-label">
            전망
          </span>
          <div className="segmented" role="radiogroup" aria-labelledby="horizon-label">
            {[0, 3, 7, 10].filter((d) => d <= horizon).map((d) => (
              <button key={d} role="radio" aria-checked={offset === d} onClick={() => setParams({ d: String(d) })} className="segmented-item">
                {d === 0 ? "오늘" : `+${d}일`}
              </button>
            ))}
          </div>
        </div>
        <label className="min-w-[200px] flex-1">
          <span className="field-label">
            날짜 <span className="num ml-1 font-bold text-slate-900">{addDays(issuedDate, offset)}</span>
          </span>
          <input
            type="range"
            min={0}
            max={horizon}
            value={offset}
            onChange={(e) => setParams({ d: e.target.value })}
            aria-valuetext={addDays(issuedDate, offset)}
            className="h-9 w-full accent-brand-600"
          />
        </label>
        <button className="btn-secondary btn-sm h-9" onClick={share} title="현재 조건이 담긴 링크를 복사">
          {copied ? "복사됨" : "링크 공유"}
        </button>
      </div>

      {/* 지도 + 패널 */}
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="card relative h-[62vh] min-h-[440px] overflow-hidden bg-slate-100 p-0">
          <div ref={containerRef} className="h-full w-full" aria-label={`${pestName} 위험도 지도`} role="application" />
          {loading && (
            <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-white/90 px-3 py-1 text-xs text-slate-500 shadow-card backdrop-blur">불러오는 중…</div>
          )}
          <div className="absolute bottom-3 left-3 max-w-[calc(100%-1.5rem)] rounded-xl border border-white/60 bg-white/85 px-3.5 py-2.5 text-xs shadow-lift backdrop-blur-md" aria-label="범례">
            <div className="mb-1.5 font-semibold text-slate-800">
              {pestName} <span className="font-normal text-slate-400">· {offset === 0 ? "오늘" : `+${offset}일`}</span>
            </div>
            <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-600">
              {counts.map((g) => (
                <li key={g.name} className="flex items-center gap-1.5">
                  <span className="inline-block rounded-full ring-2 ring-white" style={{ width: 8 + gradeRank(g.name) * 2.5, height: 8 + gradeRank(g.name) * 2.5, background: g.color }} aria-hidden="true" />
                  {g.name} <b className="num text-slate-900">{g.n}</b>
                </li>
              ))}
              {naCount > 0 && (
                <li className="flex items-center gap-1.5 text-slate-400" title="비재배지·재배 시기 아님">
                  <span className="inline-block h-2 w-2 rounded-full border-[1.5px] bg-white" style={{ borderColor: NA.stroke }} aria-hidden="true" />
                  {NA.label} <b className="num text-slate-500">{naCount}</b>
                </li>
              )}
            </ul>
          </div>
        </div>
        <aside className="card p-5" aria-label="선택 지점 정보">
          {selected ? (
            <SpotPanel code={selected} pestId={pestId} pests={pests} horizon={horizon} onClose={() => setParams({ spot: null })} />
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
              {pestName} {addDays(issuedDate, offset)} 기준 지점별 위험도
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
