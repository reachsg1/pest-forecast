// 홈 화면용 서버 헬퍼: 시즌 돌아보기(실제 예찰), 예측 정확도, 다음 시즌 일정, 겨울나기 정보.
// 모두 배치가 만든 public/data JSON에서 읽는다(근거 없는 값은 만들지 않음).
import { promises as fs } from "fs";
import path from "path";
import type { PestCard, RiskFile, Summary } from "./types";

const DATA_DIR = path.join(process.cwd(), "public", "data");

async function readJson<T>(rel: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(DATA_DIR, rel), "utf-8")) as T;
  } catch {
    return null;
  }
}

type TrendYear = {
  year: number;
  n_records: number;
  n_sigungu: number;
  occ_rate: number;
  sgg_occ_rate: number;
  max: number;
  peak_date: string;
  top_sigungu: { sigungu: string; max: number }[];
  rounds: { date: string }[];
};
type TrendDoc = { pest_id: string; item: string; unit: string; source: string; years: TrendYear[] };

export type SeasonRecap = {
  pest_id: string;
  name_ko: string;
  crop: string;
  crop_ko: string;
  item: string;
  unit: string;
  year: number;
  sggOcc: number; // 조사 시군 중 한 번이라도 발생한 비율(0~1)
  normal: number | null; // 그 전 해들의 평균(평년)
  normalYears: string; // "2015~2025"
  vsNormal: "높음" | "비슷" | "낮음" | null;
  peak: string;
  top: { sigungu: string; max: number }[];
  history: { year: number; v: number }[];
  firstRound: string;
  lastRound: string;
};

/** 마지막으로 끝난 예찰 시즌 기준 병해충별 요약(실제 NCPMS 예찰 조사값) */
export async function seasonRecaps(pests: PestCard[]): Promise<SeasonRecap[]> {
  const out: SeasonRecap[] = [];
  for (const p of pests) {
    const t = await readJson<TrendDoc>(`trend/${p.pest_id}.json`);
    if (!t?.years?.length) continue;
    const last = t.years[t.years.length - 1];
    const prev = t.years.slice(0, -1);
    const normal = prev.length >= 3 ? prev.reduce((a, y) => a + y.sgg_occ_rate, 0) / prev.length : null;
    // 평년 대비: 발생 시군 비율이 5%p 넘게 차이 나면 높음/낮음
    const vs = normal == null ? null : last.sgg_occ_rate - normal > 0.05 ? "높음" : normal - last.sgg_occ_rate > 0.05 ? "낮음" : "비슷";
    out.push({
      pest_id: p.pest_id,
      name_ko: p.name_ko,
      crop: p.crop,
      crop_ko: p.crop_ko,
      item: t.item,
      unit: t.unit,
      year: last.year,
      sggOcc: last.sgg_occ_rate,
      normal,
      normalYears: prev.length ? `${prev[0].year}~${prev[prev.length - 1].year}` : "",
      vsNormal: vs,
      peak: last.peak_date,
      top: last.top_sigungu.slice(0, 3),
      history: t.years.map((y) => ({ year: y.year, v: y.sgg_occ_rate })),
      firstRound: last.rounds[0]?.date ?? "",
      lastRound: last.rounds[last.rounds.length - 1]?.date ?? "",
    });
  }
  return out;
}

export type Accuracy = { pest_id: string; name: string; auc: number; rule: number | null; testYears: string };

/** 예찰로 검증한 기본 모델의 정확도(AUC). 검증 자료가 있는 병해충만 */
export function accuracies(pests: PestCard[]): Accuracy[] {
  const out: Accuracy[] = [];
  for (const p of pests) {
    const e = p.eval as unknown as { status?: string; test?: { auc?: Record<string, number> }; test_by_year?: Record<string, unknown> } | undefined;
    const auc = e?.status === "survey_evaluated" ? e.test?.auc?.survey_logit : undefined;
    if (auc == null) continue;
    const ys = Object.keys(e?.test_by_year ?? {}).sort();
    out.push({
      pest_id: p.pest_id,
      name: p.name_ko.startsWith(p.crop_ko) ? p.name_ko : `${p.crop_ko} ${p.name_ko}`,
      auc,
      rule: e?.test?.auc?.default_rule ?? null,
      testYears: ys.length ? `${ys[0]}~${ys[ys.length - 1]}` : "",
    });
  }
  return out.sort((a, b) => b.auc - a.auc);
}

export type NextSeason = { crop: string; crop_ko: string; start: string; dday: number; pests: string[] };

/** 작물별 다음 위험도 계산 시작일(모델 카드 season.start_month의 가장 이른 달 1일) */
export function nextSeasons(pests: PestCard[], today: string): NextSeason[] {
  const t = new Date(`${today}T00:00:00+09:00`);
  const by = new Map<string, PestCard[]>();
  for (const p of pests) by.set(p.crop, [...(by.get(p.crop) ?? []), p]);
  const out: NextSeason[] = [];
  for (const [crop, ps] of by) {
    const m = Math.min(...ps.map((p) => p.season.start_month));
    let y = t.getFullYear();
    let start = new Date(`${y}-${String(m).padStart(2, "0")}-01T00:00:00+09:00`);
    if (start <= t) start = new Date(`${++y}-${String(m).padStart(2, "0")}-01T00:00:00+09:00`);
    out.push({
      crop,
      crop_ko: ps[0].crop_ko,
      start: `${y}-${String(m).padStart(2, "0")}-01`,
      dday: Math.round((start.getTime() - t.getTime()) / 86400000),
      pests: ps.map((p) => p.name_ko),
    });
  }
  return out.sort((a, b) => a.dday - b.dday);
}

/** NCPMS 방제 요령에서 '겨울을 나는 곳' 문장 한 개(없으면 null) */
export async function overwinter(pestId: string): Promise<string | null> {
  const c = await readJson<{ ncpms: { environment: string; prevention: string }[] }>(`control/${pestId}.json`);
  if (!c) return null;
  for (const n of c.ncpms) {
    const sents = `${n.environment} ${n.prevention}`
      .split(/(?<=[.다])\s+/)
      .map((s) => s.replace(/^[○\-·\s]+/, "").trim())
      .filter((s) => /겨울|월동/.test(s) && s.length < 160);
    if (sents.length) return sents[0];
  }
  return null;
}

/** 앞으로 7일 안에 경보(75 이상)가 예상되는 지점 수와 병해충 */
export async function outlook(summary: Summary): Promise<{ spots: number; todayAlert: number; pests: { pest_id: string; name: string; crop: string; n: number }[] }> {
  const per: { pest_id: string; name: string; crop: string; n: number }[] = [];
  const all = new Set<string>();
  const today = new Set<string>(); // 오늘 주의보 이상인 관측지점(병해충이 겹쳐도 한 곳으로)
  for (const p of summary.pests) {
    if (!(p.n_applicable ?? 0)) continue;
    const r = await readJson<RiskFile>(`risk/${p.pest_id}.json`);
    if (!r) continue;
    let n = 0;
    for (const s of r.spots) {
      if (s.grade_today === "주의보" || s.grade_today === "경보") today.add(s.spot_code);
      const vs = (s.index_by_offset ?? []).slice(1, 8);
      if (vs.some((v) => v != null && v >= 75)) {
        n++;
        all.add(s.spot_code);
      }
    }
    if (n) per.push({ pest_id: p.pest_id, name: p.name_ko.startsWith(p.crop_ko) ? p.name_ko : `${p.crop_ko} ${p.name_ko}`, crop: p.crop, n });
  }
  return { spots: all.size, todayAlert: today.size, pests: per.sort((a, b) => b.n - a.n) };
}
