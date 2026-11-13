import { ImageResponse } from "next/og";
import { promises as fs } from "fs";
import path from "path";
import { MAP_H, MAP_W, featurePath } from "@/lib/mapColor";
import { todayMap } from "@/lib/todayMap";

// 카카오톡·메신저 링크 미리보기 그림(1200×630). 매일 배치 커밋 → 재배포 때 다시 만든다. 내용은 lib/todayMap(로그인 화면 맛보기와 같음).
export const alt = "병해충 발생 예측 — 오늘의 위험 지도";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OgImage() {
  const [{ eyebrow, title, sub, geo, colors }, font] = await Promise.all([
    todayMap(),
    fs.readFile(path.join(process.cwd(), "assets", "Pretendard-Bold.ttf")),
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          fontFamily: "Pretendard",
          color: "#fff",
          background: "radial-gradient(70% 90% at 85% 15%, rgba(52,211,153,0.30) 0%, transparent 60%), linear-gradient(135deg, #052e2b 0%, #0b3b36 45%, #0f172a 100%)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: 660, padding: "64px 0 56px 72px" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 26, color: "#a7f3d0" }}>{eyebrow}</div>
            <div style={{ display: "flex", flexDirection: "column", marginTop: 26, fontSize: Math.max(title[0].length, title[1].length) > 12 ? 48 : 64, lineHeight: 1.18, letterSpacing: -1.5 }}>
              <span>{title[0]}</span>
              <span style={{ color: "#fcd34d" }}>{title[1]}</span>
            </div>
            <div style={{ display: "flex", marginTop: 26, fontSize: 26, color: "rgba(255,255,255,0.72)" }}>{sub}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 24, color: "rgba(255,255,255,0.6)" }}>
            <div style={{ display: "flex", width: 14, height: 14, borderRadius: 7, background: "#34d399" }} />
            병해충 발생 예측 · 내 지역 위험도 보기
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1, paddingRight: 40 }}>
          {geo && (
            <svg width={470} height={Math.round((470 * MAP_H) / MAP_W)} viewBox={`0 0 ${MAP_W} ${MAP_H}`}>
              {geo.features.map((f) => (
                <path key={f.properties.key} d={featurePath(f.geometry, 0)} fill={colors.get(f.properties.key) ?? "rgba(255,255,255,0.08)"} stroke="rgba(255,255,255,0.2)" strokeWidth={0.6} />
              ))}
            </svg>
          )}
        </div>
      </div>
    ),
    { ...size, fonts: [{ name: "Pretendard", data: font, weight: 700, style: "normal" }] },
  );
}
