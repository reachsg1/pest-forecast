// 배경지도: 위성(기본) / 일반. 두 소스를 한 스타일에 넣고 레이어 표시만 바꾼다(위험도 레이어 유지).
// 개발용 타일: 위성 Esri World Imagery, 일반 OSM. 운영 전 VWorld(위성·하이브리드·기본) 타일로 교체(HANDOFF TODO).
export type Basemap = "satellite" | "street";
export const BASEMAP_LAYERS: Record<Basemap, string[]> = { satellite: ["sat", "sat-labels"], street: ["osm"] };
export const MAP_STYLE = {
  version: 8 as const,
  sources: {
    sat: {
      type: "raster" as const,
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256,
      maxzoom: 18,
      attribution: "위성영상 © Esri, Maxar, Earthstar Geographics",
    },
    "sat-labels": {
      type: "raster" as const,
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256,
      maxzoom: 18,
    },
    osm: {
      type: "raster" as const,
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [
    { id: "sat", type: "raster" as const, source: "sat", paint: { "raster-saturation": -0.15, "raster-contrast": 0.05 } },
    { id: "sat-labels", type: "raster" as const, source: "sat-labels", paint: { "raster-opacity": 0.85 } },
    { id: "osm", type: "raster" as const, source: "osm", layout: { visibility: "none" as const } },
  ],
};
