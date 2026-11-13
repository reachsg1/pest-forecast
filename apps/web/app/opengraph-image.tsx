import { ImageResponse } from "next/og";
import { promises as fs } from "fs";
import path from "path";
import { getPests, getSummary } from "@/lib/data";
import { pestFullName } from "@/lib/grades";
import { outlook, seasonRecaps } from "@/lib/home";
import { MAP_H, MAP_W, featurePath, idxColor, obsColor, p90 } from "@/lib/mapColor";
import { assignSpots, sggValues, type SggGeo } from "@/lib/sgg";
import type { Grade, RiskFile } from "@/lib/types";

// 카카오톡·메신저 링크 미리보기 그림(1200×630). 매일 배치 커밋 → 재배포 때 다시 만든다.
export const alt = "병해충 발생 예측 — 오늘의 위험 지도";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const PUB = path.join(process.cwd(), "public");
const read = async <T,>(rel: string): Promise<T | null> => {
  try {
    return JSON.parse(await fs.readFile(path.join(PUB, rel), "utf-8")) as T;
  } catch {
    return null;
  }
};
const ALERT: Grade[] = ["주의보", "경보"];

export default async function OgImage() {
  const [summary, pests, geo, font] = await Promise.all([
    getSummary(),
    getPests(),
    read<SggGeo>("geo/sigungu.json"),
    fs.readFile(path.join(process.cwd(), "assets", "Pretendard-Bold.ttf")),
  ]);

  let eyebrow = "병해충 발생 예측";
  let title: string[] = ["오늘의 병해충", "발생 위험"];
  let sub = "농업기상으로 매일 계산하는 시군별 병해충 위험도";
  let colors = new Map<string, string>();

  if (summary) {
    const inSeason = summary.pests.some((p) => (p.n_applicable ?? 0) > 0);
    const date = summary.issued_date.replace(/^(\d{4})-(\d{2})-(\d{2})$/, (_, y, m, d) => `${y}.${Number(m)}.${Number(d)}.`);
    if (inSeason) {
      const alerting = summary.pests.filter((p) => ALERT.some((g) => (p.grade_counts[g] ?? 0) > 0));
      const n = (await outlook(summary)).todayAlert; // 병해충이 겹쳐도 한 곳으로 센 관측지점 수
      eyebrow = `${date} 병해충 위험도`;
      title = n > 0 ? ["오늘 주의보 이상", `${n}곳`] : ["오늘은 주의보 이상인", "곳이 없어요"];
      sub = alerting.length ? alerting.slice(0, 3).map((p) => pestFullName(p.crop_ko, p.name_ko)).join(" · ") : "앞으로 7일 전망과 내 농장 위험도를 확인하세요";
      const lead = alerting[0] ?? summary.pests.find((p) => (p.n_applicable ?? 0) > 0);
      const r = lead ? await read<RiskFile>(`data/risk/${lead.pest_id}.json`) : null;
      if (geo && r) {
        const vals = sggValues(geo, assignSpots(geo, r.spots), new Map(r.spots.map((s) => [s.spot_code, { name: s.name, index: s.index_today }])));
        colors = new Map(vals.map((v) => [v.key, idxColor(v.idx, "rgba(255,255,255,0.08)")]));
      }
    } else {
      const recaps = await seasonRecaps(pests);
      const lead = recaps.sort((a, b) => b.sggOcc - a.sggOcc)[0];
      if (lead) {
        eyebrow = `${lead.year} 시즌 돌아보기 · NCPMS 예찰`;
        title = [`올해 ${pestFullName(lead.crop_ko, lead.name_ko)},`, `조사 시군 ${Math.round(lead.sggOcc * 100)}%에서 발생`];
        sub = lead.normal != null ? `평년 ${Math.round(lead.normal * 100)}% · 가장 심했던 곳 ${lead.top[0]?.sigungu.split(" ").slice(1).join(" ")} ${lead.top[0]?.max}%` : "";
        const v = await read<{ rounds: { date: string; rows: [string, number][] }[] }>(`data/surveyview/${lead.pest_id}.json`);
        if (v) {
          const rounds = v.rounds.filter((x) => x.date.startsWith(String(lead.year)));
          const max = new Map<string, number>();
          rounds.forEach((x) => x.rows.forEach(([k, val]) => max.set(k, Math.max(max.get(k) ?? 0, val))));
          const vmax = p90(Array.from(max.values()));
          colors = new Map(Array.from(max.entries()).map(([k, val]) => [k, obsColor(val, vmax, "rgba(255,255,255,0.08)")]));
        }
      }
    }
  }

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
