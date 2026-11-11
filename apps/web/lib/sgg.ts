/**
 * 예측 지도 '시군' 보기: 시군 경계(public/geo/sigungu.json)에 지점 위험도를 모아 색으로 칠한다.
 * - 지점 → 시군: 지점 좌표가 들어 있는 경계(주소 이름 아님 — 경계는 최신 행정구역이라 이름이 다를 수 있음)
 * - 지점이 없는 시군: 경계 대표점에서 가장 가까운 지점으로 대체(거리 표시)
 * - 시군 값: 그 시군 지점 중 가장 높은 위험지수(경보를 놓치지 않게). 모두 해당 없음이면 해당 없음
 */
import { GRADES, gradeOf } from "./grades";
import type { Grade } from "./types";

type Ring = [number, number][];
type Poly = Ring[];
export type SggFeature = {
  type: "Feature";
  properties: { key: string; name: string; lat: number; lon: number };
  geometry: { type: "Polygon"; coordinates: Poly } | { type: "MultiPolygon"; coordinates: Poly[] };
};
export type SggGeo = { type: "FeatureCollection"; attribution?: string; features: SggFeature[] };

function inRing([x, y]: [number, number], ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inPoly(pt: [number, number], poly: Poly): boolean {
  if (!poly.length || !inRing(pt, poly[0])) return false;
  return !poly.slice(1).some((hole) => inRing(pt, hole));
}

function contains(f: SggFeature, pt: [number, number]): boolean {
  return f.geometry.type === "Polygon" ? inPoly(pt, f.geometry.coordinates) : f.geometry.coordinates.some((p) => inPoly(pt, p));
}

function km(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLon = ((b[1] - a[1]) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export type SggAssign = Record<string, { codes: string[]; subKm: number | null }>;

/** 시군 키 → 지점 코드들(없으면 가장 가까운 지점 1곳과 거리) */
export function assignSpots(geo: SggGeo, spots: { spot_code: string; lat: number | null; lon: number | null }[]): SggAssign {
  const pts = spots.filter((s) => s.lat != null && s.lon != null) as { spot_code: string; lat: number; lon: number }[];
  const out: SggAssign = {};
  geo.features.forEach((f) => (out[f.properties.key] = { codes: [], subKm: null }));
  for (const s of pts) {
    const f = geo.features.find((g) => contains(g, [s.lon, s.lat]));
    if (f) out[f.properties.key].codes.push(s.spot_code);
  }
  for (const f of geo.features) {
    const a = out[f.properties.key];
    if (a.codes.length || !pts.length) continue;
    let best = pts[0];
    let bd = Infinity;
    for (const s of pts) {
      const d = km([f.properties.lat, f.properties.lon], [s.lat, s.lon]);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    a.codes = [best.spot_code];
    a.subKm = Math.round(bd);
  }
  return out;
}

/** 위험지수 → 연속 색(등급 경계 0·25·50·75에서 각 등급색으로 이어짐). 해당 없음은 -1 */
export const SGG_FILL = [
  "case",
  ["<", ["get", "idx"], 0],
  "#e2e8f0",
  ["interpolate", ["linear"], ["get", "idx"], 0, "#f1f5f9", 24, GRADES[0].color, 25, "#9fd3b4", 49, GRADES[1].color, 50, "#f3cf7a", 74, GRADES[2].color, 75, "#ef8f7a", 100, GRADES[3].color],
] as unknown as string;

/** 범례용 CSS 그라데이션(위 색과 같음) */
export const SGG_GRADIENT = `linear-gradient(to right, #f1f5f9 0%, ${GRADES[0].color} 24%, #9fd3b4 25%, ${GRADES[1].color} 49%, #f3cf7a 50%, ${GRADES[2].color} 74%, #ef8f7a 75%, ${GRADES[3].color} 100%)`;

export type SggValue = { key: string; idx: number | null; grade: Grade | null; n: number; topCode: string | null; topName: string; subKm: number | null };

export function sggValues(
  geo: SggGeo,
  assign: SggAssign,
  byCode: Map<string, { name: string; index: number | null }>,
): SggValue[] {
  return geo.features.map((f) => {
    const a = assign[f.properties.key] ?? { codes: [], subKm: null };
    let idx: number | null = null;
    let top: string | null = null;
    for (const c of a.codes) {
      const v = byCode.get(c)?.index;
      if (v != null && (idx == null || v > idx)) {
        idx = v;
        top = c;
      }
    }
    const topCode = top ?? a.codes[0] ?? null;
    return { key: f.properties.key, idx, grade: idx == null ? null : gradeOf(idx), n: a.codes.length, topCode, topName: topCode ? (byCode.get(topCode)?.name ?? "") : "", subKm: a.subKm };
  });
}
