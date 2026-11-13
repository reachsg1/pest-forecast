// 홈 히어로 지도·공유 미리보기 그림이 함께 쓰는 투영·색(서버·클라이언트 공용, 라이브러리 없음)
import { GRADES } from "./grades";

export const LON0 = 124.55;
export const LAT0 = 38.65;
const KX = 100 * Math.cos((36.3 * Math.PI) / 180);
const KY = 100;
export const MAP_W = Math.round((131.0 - LON0) * KX);
export const MAP_H = Math.round((LAT0 - 33.05) * KY);
export const px = (lon: number) => (lon - LON0) * KX;
export const py = (lat: number) => (LAT0 - lat) * KY;

export const EMPTY = "rgba(255,255,255,0.07)";
export const ZERO = "rgba(52,211,153,0.30)";

export function mix(a: string, b: string, t: number) {
  const h = (s: string) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
  const [x, y] = [h(a), h(b)];
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(",")})`;
}

/** 위험지수 → 색(등급 경계에서 각 등급색으로) */
export function idxColor(v: number | null | undefined, empty = EMPTY) {
  if (v == null) return empty;
  const stops: [number, string][] = [
    [0, "#64748b"],
    [24, GRADES[0].color],
    [25, "#4fb37a"],
    [49, GRADES[1].color],
    [50, "#f3cf7a"],
    [74, GRADES[2].color],
    [75, "#ef8f7a"],
    [100, GRADES[3].color],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const [a, ca] = stops[i - 1];
      const [b, cb] = stops[i];
      return mix(ca, cb, b === a ? 1 : (v - a) / (b - a));
    }
  }
  return GRADES[3].color;
}

/** 예찰 조사값 → 색(0 = 발생 없음, 그 위는 노랑→빨강, vmax에서 포화) */
export function obsColor(v: number | null | undefined, vmax: number, empty = EMPTY, zero = ZERO) {
  if (v == null) return empty;
  if (v <= 0) return zero;
  const t = Math.min(1, Math.sqrt(v / vmax));
  return t < 0.5 ? mix("#f3cf7a", GRADES[2].color, t * 2) : mix(GRADES[2].color, GRADES[3].color, (t - 0.5) * 2);
}

type Ring = [number, number][];
export function featurePath(geometry: { type: "Polygon"; coordinates: Ring[] } | { type: "MultiPolygon"; coordinates: Ring[][] }, nd = 1) {
  const polys = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polys
    .map((poly) => poly.map((ring) => ring.map(([lon, lat], i) => `${i ? "L" : "M"}${px(lon).toFixed(nd)} ${py(lat).toFixed(nd)}`).join("") + "Z").join(""))
    .join("");
}

/** 연도 안 양수 조사값의 90% 분위(색 포화점) */
export function p90(values: number[]) {
  const pos = values.filter((x) => x > 0).sort((a, b) => a - b);
  return pos.length ? pos[Math.floor(pos.length * 0.9)] || pos[pos.length - 1] : 1;
}
