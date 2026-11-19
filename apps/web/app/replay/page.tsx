import type { Metadata } from "next";
import Link from "next/link";
import { promises as fs } from "fs";
import path from "path";
import BacktestReplay from "@/components/BacktestReplay";
import { PageHeader } from "@/components/ui";
import { getPests, isAdminRequest } from "@/lib/data";
import { pestFullName } from "@/lib/grades";

export const metadata: Metadata = { title: "예측과 실제" };

type Bt = {
  pest_id: string;
  threshold_index: number;
  train_years: number[];
  test_years: number[];
  models: { key: string; is_default: boolean }[];
  rounds: { year: number; split: "train" | "test"; rows: { actual: number; pred: Record<string, number> }[] }[];
};

const pct = (v: number) => `${Math.round(v * 100)}%`;
const span = (ys: number[]) => (ys.length ? (ys.length > 1 ? `${ys[0]}~${ys[ys.length - 1]}` : `${ys[0]}`) : "");

/** 검증 연도(학습에 안 쓴 해) 기본 모델 성적: 정확도·실제 발생을 미리 알린 비율·헛경보 비율 */
function summary(b: Bt) {
  const key = (b.models.find((m) => m.is_default) ?? b.models[0]).key;
  const rows = b.rounds.filter((r) => r.split === "test").flatMap((r) => r.rows);
  const thr = b.threshold_index;
  let hit = 0, miss = 0, fa = 0, cn = 0;
  for (const r of rows) {
    const p = Math.floor(r.pred[key] ?? 0) >= thr;
    const a = r.actual > 0;
    if (p && a) hit++;
    else if (!p && !a) cn++;
    else if (a) miss++;
    else fa++;
  }
  const n = rows.length;
  return { n, acc: n ? (hit + cn) / n : 0, recall: hit + miss ? hit / (hit + miss) : 0, falseRate: hit + fa ? fa / (hit + fa) : 0, occurred: hit + miss };
}

export default async function ReplayPage({ searchParams }: { searchParams: Promise<{ pest?: string }> }) {
  const { pest } = await searchParams;
  const [pests, admin] = await Promise.all([getPests(), isAdminRequest()]);
  const dir = path.join(process.cwd(), "public", "data", "backtest");
  const files = await fs.readdir(dir).catch(() => [] as string[]);
  const cards = (
    await Promise.all(
      pests.map(async (p) => {
        if (!files.includes(`${p.pest_id}.json`)) return null;
        try {
          const b = JSON.parse(await fs.readFile(path.join(dir, `${p.pest_id}.json`), "utf-8")) as Bt;
          const testYears = Array.from(new Set(b.rounds.filter((r) => r.split === "test").map((r) => r.year))).sort();
          return { p, b, s: summary(b), trainYears: [...b.train_years].sort(), testYears };
        } catch {
          return null;
        }
      }),
    )
  )
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.s.n - a.s.n); // 검증 자료가 많은 병해충부터
  const sel = cards.find((c) => c.p.pest_id === pest) ?? cards[0];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="예찰로 검증"
        title="예측과 실제"
        desc="모델이 그날 냈을 위험도와 실제 NCPMS 예찰 결과를 시군별로 맞대어 봐요. 학습에 쓰지 않은 해(검증 연도)가 정직한 성적이에요."
      />

      {cards.length === 0 ? (
        <p className="card p-5 text-sm text-slate-500">아직 비교할 자료가 없어요.</p>
      ) : (
        <>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {cards.map(({ p, s, trainYears, testYears }) => {
              const on = sel?.p.pest_id === p.pest_id;
              return (
                <li key={p.pest_id}>
                  <Link
                    href={`/replay?pest=${p.pest_id}`}
                    scroll={false}
                    aria-current={on ? "page" : undefined}
                    className={`card block h-full p-4 transition ${on ? "ring-2 ring-brand-500" : "hover:shadow-lift"}`}
                  >
                    <p className="text-sm font-semibold text-slate-900">{pestFullName(p.crop_ko, p.name_ko)}</p>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      학습 {span(trainYears)} · 검증 {span(testYears)} ({s.n.toLocaleString()}건)
                    </p>
                    <p className="mt-3 flex items-baseline gap-1.5">
                      <span className="num text-2xl font-bold tracking-tight text-slate-900">{pct(s.acc)}</span>
                      <span className="text-xs text-slate-500">맞힘</span>
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-slate-500">
                      실제 발생 {s.occurred.toLocaleString()}곳 중 <b className="num font-semibold text-slate-700">{pct(s.recall)}</b> 미리 알림 · 경보 중 헛경보{" "}
                      <b className="num font-semibold text-slate-700">{pct(s.falseRate)}</b>
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>

          {sel && (
            <section className="card card-pad" aria-label={`${pestFullName(sel.p.crop_ko, sel.p.name_ko)} 날짜별 비교`}>
              <BacktestReplay key={sel.p.pest_id} pestId={sel.p.pest_id} allModels={admin} />
            </section>
          )}

          <p className="text-xs leading-relaxed text-slate-400">
            판정: 위험지수 50(주의보) 이상을 &lsquo;발생 예상&rsquo;, 예찰 조사값 0 초과를 &lsquo;실제 발생&rsquo;으로 봐요. 맞힘 = 발생·미발생을 모두 맞힌 비율. 학습 연도 화면은 모델이 이미 본 자료라 성적이 실제보다 좋게 나와요. 자료: NCPMS 시군 예찰, 모델 입력은 조사일 전날까지의 기상과 같은 해 직전 회차 예찰값.
          </p>
        </>
      )}
    </div>
  );
}
