import { promises as fs } from "fs";
import path from "path";
import { getPests, getSummary } from "@/lib/data";
import { pestFullName } from "@/lib/grades";
import { outlook, seasonRecaps } from "@/lib/home";
import { idxColor, obsColor, p90 } from "@/lib/mapColor";
import { assignSpots, sggValues, type SggGeo } from "@/lib/sgg";
import type { Grade, RiskFile } from "@/lib/types";

/**
 * '오늘의 지도' 한 장 — 링크 미리보기 그림(opengraph-image)과 로그인 화면 맛보기가 같이 쓴다.
 * 재배 시기면 오늘 위험지수(주의보 이상이 가장 많은 병해충), 아니면 지난 시즌 NCPMS 예찰 최고값.
 */
const PUB = path.join(process.cwd(), "public");
const read = async <T,>(rel: string): Promise<T | null> => {
  try {
    return JSON.parse(await fs.readFile(path.join(PUB, rel), "utf-8")) as T;
  } catch {
    return null;
  }
};
const ALERT: Grade[] = ["주의보", "경보"];

export type TodayMap = {
  mode: "live" | "season" | "none";
  eyebrow: string;
  title: [string, string];
  sub: string;
  caption: string; // 지도 한 줄 설명(무슨 병해충의 어떤 값인지)
  geo: SggGeo | null;
  colors: Map<string, string>;
};

export async function todayMap(empty = "rgba(255,255,255,0.08)"): Promise<TodayMap> {
  const [summary, pests, geo] = await Promise.all([getSummary(), getPests(), read<SggGeo>("geo/sigungu.json")]);
  const out: TodayMap = {
    mode: "none",
    eyebrow: "병해충 발생 예측",
    title: ["오늘의 병해충", "발생 위험"],
    sub: "농업기상으로 매일 계산하는 시군별 병해충 위험도",
    caption: "",
    geo,
    colors: new Map(),
  };
  if (!summary) return out;

  const inSeason = summary.pests.some((p) => (p.n_applicable ?? 0) > 0);
  const date = summary.issued_date.replace(/^(\d{4})-(\d{2})-(\d{2})$/, (_, y, m, d) => `${y}.${Number(m)}.${Number(d)}.`);
  if (inSeason) {
    const alerting = summary.pests.filter((p) => ALERT.some((g) => (p.grade_counts[g] ?? 0) > 0));
    const n = (await outlook(summary)).todayAlert; // 병해충이 겹쳐도 한 곳으로 센 관측지점 수
    out.mode = "live";
    out.eyebrow = `${date} 병해충 위험도`;
    out.title = n > 0 ? ["오늘 주의보 이상", `${n}곳`] : ["오늘은 주의보 이상인", "곳이 없어요"];
    out.sub = alerting.length ? alerting.slice(0, 3).map((p) => pestFullName(p.crop_ko, p.name_ko)).join(" · ") : "앞으로 7일 전망과 내 농장 위험도를 확인하세요";
    const lead = alerting[0] ?? summary.pests.find((p) => (p.n_applicable ?? 0) > 0);
    const r = lead ? await read<RiskFile>(`data/risk/${lead.pest_id}.json`) : null;
    if (lead) out.caption = `${date} ${pestFullName(lead.crop_ko, lead.name_ko)} 위험도`;
    if (geo && r) {
      const vals = sggValues(geo, assignSpots(geo, r.spots), new Map(r.spots.map((s) => [s.spot_code, { name: s.name, index: s.index_today }])));
      out.colors = new Map(vals.map((v) => [v.key, idxColor(v.idx, empty)]));
    }
    return out;
  }

  const recaps = await seasonRecaps(pests);
  const lead = recaps.sort((a, b) => b.sggOcc - a.sggOcc)[0];
  if (!lead) return out;
  const name = pestFullName(lead.crop_ko, lead.name_ko);
  out.mode = "season";
  out.eyebrow = `${lead.year} 시즌 돌아보기 · NCPMS 예찰`;
  out.title = [`올해 ${name},`, `조사 시군 ${Math.round(lead.sggOcc * 100)}%에서 발생`];
  out.sub = lead.normal != null ? `평년 ${Math.round(lead.normal * 100)}% · 가장 심했던 곳 ${lead.top[0]?.sigungu.split(" ").slice(1).join(" ")} ${lead.top[0]?.max}%` : "";
  out.caption = `${lead.year} ${name} · 시군 예찰 최고값`;
  const v = await read<{ rounds: { date: string; rows: [string, number][] }[] }>(`data/surveyview/${lead.pest_id}.json`);
  if (v) {
    const max = new Map<string, number>();
    v.rounds.filter((x) => x.date.startsWith(String(lead.year))).forEach((x) => x.rows.forEach(([k, val]) => max.set(k, Math.max(max.get(k) ?? 0, val))));
    const vmax = p90(Array.from(max.values()));
    out.colors = new Map(Array.from(max.entries()).map(([k, val]) => [k, obsColor(val, vmax, empty)]));
  }
  return out;
}
