import Link from "next/link";
import { ActionBox } from "@/components/ControlGuide";
import HeroMap, { type HeroMapProps } from "@/components/HeroMap";
import MyArea from "@/components/MyArea";
import RiskBadge from "@/components/RiskBadge";
import ShareButton from "@/components/ShareButton";
import Sparkline from "@/components/Sparkline";
import { Icon } from "@/components/ui";
import { getPests, getSummary } from "@/lib/data";
import { CROP_LABEL, GRADES, gradeMeta, pestFullName } from "@/lib/grades";
import { accuracies, nextSeasons, outlook, overwinter, seasonRecaps, type SeasonRecap } from "@/lib/home";
import type { Grade, SummaryPest } from "@/lib/types";
import { fmtDate, fmtDateTime, fmtMD } from "@/lib/format";

type CropGroup = { crop: string; crop_ko: string; pests: SummaryPest[]; grown: number; top: Grade | null; alerts: number };

const ALERT: Grade[] = ["주의보", "경보"];
const alertN = (p: SummaryPest) => ALERT.reduce((a, g) => a + (p.grade_counts[g] ?? 0), 0);
const rank = (g: Grade | null) => (g ? GRADES.findIndex((x) => x.name === g) : -1);
const pct = (v: number) => `${Math.round(v * 100)}%`;
const shortSgg = (s: string) => s.split(" ").slice(1).join(" ") || s;

/**
 * 홈: 들어오자마자 '지금 어디가 위험한지'를 지도로 보여 준다.
 * - 재배 시기: 오늘~7일 뒤 위험이 번지는 지도 + 7일 전망 + 지금 할 일
 * - 재배 시기가 아닐 때: 지난 시즌 실제 예찰(NCPMS) 지도 + 시즌 돌아보기(평년 비교) + 겨울나기 + 다음 시즌 D-day
 * 공통: 내 지역, 예찰로 검증한 정확도, 공유하기
 */
export default async function HomePage() {
  const [summary, pests] = await Promise.all([getSummary(), getPests()]);
  if (!summary) {
    return (
      <div className="card card-pad text-center">
        <h1 className="section-title text-lg">아직 예측 데이터가 없습니다</h1>
        <p className="mt-2 text-sm text-slate-500">
          저장소에서 <code>python -m pipeline.cli run --demo</code> 를 실행해 <code>apps/web/public/data</code> 를 만든 뒤 다시 빌드하세요.
        </p>
      </div>
    );
  }

  const crops: CropGroup[] = Array.from(new Set(summary.pests.map((p) => p.crop))).map((c) => {
    const ps = summary.pests.filter((p) => p.crop === c).sort((a, b) => rank(b.max_grade) - rank(a.max_grade) || alertN(b) - alertN(a));
    const grown = Math.max(0, ...ps.map((p) => p.n_applicable ?? 0));
    const top = ps.reduce<Grade | null>((m, p) => (rank(p.max_grade) > rank(m) ? p.max_grade : m), null);
    return { crop: c, crop_ko: ps[0]?.crop_ko ?? CROP_LABEL[c] ?? c, pests: ps, grown, top, alerts: ps.reduce((a, p) => a + alertN(p), 0) };
  });
  crops.sort((a, b) => Number(b.grown > 0) - Number(a.grown > 0) || rank(b.top) - rank(a.top) || b.alerts - a.alerts);

  const inSeason = summary.pests.some((p) => (p.n_applicable ?? 0) > 0);
  const alerting = summary.pests.filter((p) => alertN(p) > 0).sort((a, b) => alertN(b) - alertN(a));
  const [recaps, acc, look] = await Promise.all([seasonRecaps(pests), Promise.resolve(accuracies(pests)), inSeason ? outlook(summary) : Promise.resolve(null)]);
  const alertSpots = look?.todayAlert ?? 0; // 병해충이 겹쳐도 한 곳으로 센 관측지점 수
  const next = nextSeasons(pests, summary.issued_date);
  const winter = Object.fromEntries(await Promise.all(recaps.map(async (r) => [r.pest_id, await overwinter(r.pest_id)] as const)));
  const pestLite = pests.map((p) => ({ pest_id: p.pest_id, name_ko: p.name_ko, crop: p.crop, crop_ko: p.crop_ko }));

  // 히어로 지도: 재배 시기면 가장 위험한 병해충의 7일, 아니면 지난 시즌 가장 넓게 발생한 병해충의 실제 예찰
  const livePest = inSeason ? (alerting[0] ?? summary.pests.filter((p) => (p.n_applicable ?? 0) > 0).sort((a, b) => rank(b.max_grade) - rank(a.max_grade))[0]) : null;
  const lead = recaps.slice().sort((a, b) => b.sggOcc - a.sggOcc)[0] ?? null;
  const mapProps: HeroMapProps | null = livePest
    ? { mode: "live", pestId: livePest.pest_id, caption: `${pestFullName(livePest.crop_ko, livePest.name_ko)} 위험지수 · 오늘부터 7일 뒤까지(시군 안 관측지점 중 최고값)` }
    : lead
      ? { mode: "season", pestId: lead.pest_id, year: lead.year, unit: lead.unit, caption: `${lead.year} ${pestFullName(lead.crop_ko, lead.name_ko)} 실제 발생 · NCPMS 예찰 조사값(${lead.item}) ${fmtMD(lead.firstRound)}~${fmtMD(lead.lastRound)}` }
      : null;

  const shareText = inSeason
    ? alertSpots > 0
      ? `오늘 병해충 주의보 이상 ${alertSpots}곳 — ${alerting.slice(0, 2).map((p) => pestFullName(p.crop_ko, p.name_ko)).join(", ")}`
      : "오늘 병해충 발생 위험 — 주의보 이상인 곳 없음"
    : lead
      ? `${lead.year} 시즌 ${pestFullName(lead.crop_ko, lead.name_ko)}, 조사 시군 ${pct(lead.sggOcc)}에서 발생`
      : "병해충 발생 예측";

  return (
    <div className="space-y-10">
      {/* ── 히어로 ─────────────────────────────────────────── */}
      <section aria-labelledby="today" className="hero-dark">
        <div className="relative grid gap-6 px-5 pb-6 pt-7 sm:px-10 sm:pb-8 sm:pt-10 lg:grid-cols-[1.05fr_1fr] lg:grid-rows-[auto_1fr] lg:gap-x-8">
          <div className="min-w-0 lg:col-start-1 lg:row-start-1">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium text-emerald-100 backdrop-blur">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              <span className="num">
                기준일 {fmtDate(summary.issued_date)} · {inSeason ? `${summary.horizon_days}일 전망` : "재배 시기 아님"}
              </span>
            </span>

            {inSeason ? (
              <>
                <h1 id="today" className="mt-5 text-3xl font-bold leading-tight tracking-tight sm:text-[2.6rem] sm:leading-[1.15]">
                  {alertSpots > 0 ? (
                    <>
                      오늘 주의보 이상
                      <br />
                      <span style={{ color: gradeMeta(alerting.some((p) => (p.grade_counts["경보"] ?? 0) > 0) ? "경보" : "주의보").color }}>
                        <span className="num">{alertSpots}</span>곳
                      </span>
                    </>
                  ) : (
                    <>
                      오늘은 주의보 이상인
                      <br />
                      곳이 없어요
                    </>
                  )}
                </h1>
                <p className="mt-3 text-base text-white/80 sm:text-lg">
                  {look && look.spots > 0 ? (
                    <>
                      앞으로 7일 안에 <b className="text-white">경보 예상 {look.spots}곳</b>
                      <span className="text-white/60"> · {look.pests.slice(0, 2).map((p) => p.name).join(", ")}</span>
                    </>
                  ) : (
                    "앞으로 7일 동안 경보가 예상되는 곳은 없어요."
                  )}
                </p>
                {alerting.length > 0 && (
                  <ul className="mt-4 flex flex-wrap gap-2" aria-label="주의보 이상 병해충">
                    {alerting.slice(0, 4).map((p) => (
                      <li key={p.pest_id}>
                        <Link href={`/map?crop=${p.crop}&pest=${p.pest_id}`} className="glass-tile inline-flex items-center gap-2 px-3 py-1.5 text-sm">
                          <span className="text-white/55">{p.crop_ko}</span>
                          <span className="font-semibold">{p.name_ko.replace(p.crop_ko, "").trim() || p.name_ko}</span>
                          <span className="num text-white/70">{alertN(p)}곳</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : lead ? (
              <>
                <p className="mt-5 text-sm font-medium text-emerald-200">{lead.year} 시즌 돌아보기</p>
                <h1 id="today" className="mt-1.5 text-[1.7rem] font-bold leading-tight tracking-tight sm:text-[2.4rem] sm:leading-[1.18]">
                  올해 {pestFullName(lead.crop_ko, lead.name_ko)},
                  <br />
                  조사한 시군 <span className="num text-amber-300">{pct(lead.sggOcc)}</span>에서
                  <br />
                  발생했어요
                </h1>
                <p className="mt-3 text-sm leading-relaxed text-white/75 sm:text-base">
                  {lead.normal != null && (
                    <>
                      평년({lead.normalYears}) {pct(lead.normal)}
                      {lead.vsNormal === "비슷" ? "과 비슷했고" : lead.vsNormal === "높음" ? "보다 높았고" : "보다 낮았고"},{" "}
                    </>
                  )}
                  가장 심했던 곳은 {lead.top.slice(0, 2).map((t) => `${shortSgg(t.sigungu)}(${t.max}%)`).join(", ")}예요.
                </p>
                {next[0] && (
                  <p className="mt-4 inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-sm">
                    <span className="text-white/60">다음 위험도 계산</span>
                    <b className="num">
                      {next[0].crop_ko} {fmtDate(next[0].start)}부터
                    </b>
                    <span className="num rounded-md bg-emerald-400/20 px-1.5 py-0.5 text-xs font-semibold text-emerald-200">D-{next[0].dday}</span>
                  </p>
                )}
              </>
            ) : (
              <h1 id="today" className="mt-5 text-3xl font-bold tracking-tight">
                오늘의 병해충 발생 위험
              </h1>
            )}

          </div>

          {mapProps && (
            <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-center">
              <HeroMap {...mapProps} />
            </div>
          )}

          <div className="min-w-0 lg:col-start-1 lg:row-start-2">
            <MyArea pests={pestLite} />

            <div className="mt-5 flex flex-wrap gap-2">
              <Link href="/map" className="btn-light">
                <Icon name="map" /> 위험도 지도
              </Link>
              <Link href="/farm" className="btn-glass">
                <Icon name="farm" /> 내 농장
              </Link>
              <ShareButton text={shareText} />
            </div>
          </div>
        </div>

        {/* 신뢰: 예찰로 검증한 정확도 */}
        {acc.length > 0 && (
          <div className="relative border-t border-white/10 px-5 py-4 sm:px-10">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <span className="text-xs font-semibold text-white/70">실제 예찰로 검증한 예측 정확도</span>
              <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
                {acc.map((a) => (
                  <li key={a.pest_id} className="text-sm">
                    <span className="text-white/60">{a.name}</span> <b className="num">{a.auc.toFixed(2)}</b>
                  </li>
                ))}
              </ul>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-white/45">
              AUC: 발생한 시군을 안 한 시군보다 위험하게 예측한 정도. 1에 가까울수록 정확하고 0.5는 찍기 수준이에요. {acc[0].testYears} NCPMS 시군 예찰(학습에 쓰지 않은 해)과 비교했어요.
            </p>
          </div>
        )}
      </section>

      {/* ── 재배 시기: 지금 할 일 ─────────────────────────── */}
      {inSeason && alerting.length > 0 && (
        <section aria-labelledby="todo" className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="todo" className="section-title text-lg">
              지금 챙길 병해충
            </h2>
            <Link href="/calendar" className="link-arrow text-xs">
              방제 일정 <Icon name="arrow" className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {alerting.slice(0, 4).map((p) => (
              <ActionBox key={p.pest_id} pestId={p.pest_id} grade={p.max_grade as Grade} pestName={pestFullName(p.crop_ko, p.name_ko)} />
            ))}
          </div>
        </section>
      )}

      {/* ── 재배 시기 아님: 시즌 돌아보기 ─────────────────── */}
      {!inSeason && recaps.length > 0 && (
        <section aria-labelledby="recap" className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 id="recap" className="section-title text-lg">
                {Math.max(...recaps.map((r) => r.year))} 시즌 돌아보기
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">NCPMS 국가 예찰의 시군별 실제 조사값이에요. 평년은 그 전 해들의 평균이에요.</p>
            </div>
            <Link href="/survey" className="link-arrow text-xs">
              과거 발생 현황 <Icon name="arrow" className="h-3.5 w-3.5" />
            </Link>
          </div>
          <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {recaps
              .slice()
              .sort((a, b) => b.sggOcc - a.sggOcc)
              .map((r) => (
                <RecapCard key={r.pest_id} r={r} winter={winter[r.pest_id] ?? null} latest={Math.max(...recaps.map((x) => x.year))} />
              ))}
          </ul>
        </section>
      )}

      {/* ── 다음 시즌 / 작물별 현황 ───────────────────────── */}
      {inSeason ? (
        <section aria-labelledby="by-crop" className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="by-crop" className="section-title text-lg">
              작물별 현황
            </h2>
            <p className="num text-xs text-slate-400">갱신 {fmtDateTime(summary.generated_at)}</p>
          </div>
          <ul className="grid gap-4 lg:grid-cols-3">
            {crops.map((c) => (
              <CropCard key={c.crop} c={c} />
            ))}
          </ul>
        </section>
      ) : (
        <section aria-labelledby="next" className="card overflow-hidden">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-5 py-3">
            <h2 id="next" className="text-base font-bold tracking-tight">
              다음 시즌 일정
            </h2>
            <p className="text-xs text-slate-400">병해충 모델이 위험도를 계산하기 시작하는 날(지역 재배 기간에 따라 더 늦을 수 있어요)</p>
          </div>
          <ul className="grid divide-y divide-slate-100 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {next.map((n) => (
              <li key={n.crop} className="px-5 py-4">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-lg font-bold tracking-tight text-slate-900">{n.crop_ko}</span>
                  <span className="num rounded-md bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">D-{n.dday}</span>
                </div>
                <div className="num mt-0.5 text-sm text-slate-600">{fmtDate(n.start)}부터</div>
                <div className="mt-1 truncate text-xs text-slate-400">{n.pests.join(" · ")}</div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── 등급 안내 ─────────────────────────────────────── */}
      <section aria-labelledby="guide" className="card card-pad">
        <h2 id="guide" className="section-title">
          등급 읽는 법
        </h2>
        <p className="mt-1 text-xs text-slate-500">위험지수는 각 병해충 모델이 기상 조건으로 계산한 0~100 값입니다.</p>
        <div className="mt-5 grid grid-cols-4 gap-1" aria-hidden="true">
          {GRADES.map((g) => (
            <div key={g.name} className="h-2 rounded-full" style={{ background: g.color }} />
          ))}
        </div>
        <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-4 md:grid-cols-4">
          {GRADES.map((g) => (
            <li key={g.name}>
              <RiskBadge grade={g.name} size="sm" />
              <div className="num mt-1.5 text-xs font-medium text-slate-700">
                {g.min} ~ {g.max}
              </div>
              <div className="text-xs text-slate-500">{g.action}</div>
            </li>
          ))}
        </ul>
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4 text-xs text-slate-500">
          <RiskBadge grade={null} size="sm" /> 작물을 재배하지 않는 지역이거나 재배 기간이 아닌 날. 위험도를 계산하지 않습니다.
        </div>
      </section>
    </div>
  );
}

function RecapCard({ r, winter, latest }: { r: SeasonRecap; winter: string | null; latest: number }) {
  const tone = r.vsNormal === "높음" ? "bg-amber-50 text-amber-800 ring-amber-200" : r.vsNormal === "낮음" ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-slate-100 text-slate-600 ring-slate-200";
  const maxV = Math.max(...r.history.map((h) => h.v), 0.01);
  return (
    <li className="card flex flex-col overflow-hidden">
      <div className="flex items-start justify-between gap-3 px-5 pt-4">
        <div className="min-w-0">
          <p className="text-xs text-slate-400">
            {r.crop_ko}
            {r.year < latest && <span className="num text-amber-700"> · 최근 자료 {r.year}년</span>}
          </p>
          <h3 className="truncate text-lg font-bold tracking-tight text-slate-900">{r.name_ko.replace(r.crop_ko, "").trim() || r.name_ko}</h3>
        </div>
        {r.vsNormal && <span className={`chip shrink-0 ring-1 ring-inset ${tone}`}>평년보다 {r.vsNormal === "비슷" ? "비슷" : r.vsNormal}</span>}
      </div>

      <div className="flex items-end justify-between gap-4 px-5 pt-3">
        <div>
          <div className="num text-3xl font-bold tracking-tight text-slate-900">{pct(r.sggOcc)}</div>
          <div className="text-xs text-slate-500">
            조사 시군 중 발생{r.normal != null && <span className="num text-slate-400"> · 평년 {pct(r.normal)}</span>}
          </div>
        </div>
        {/* 연도별 발생 시군 비율(마지막 해 강조) */}
        <svg viewBox={`0 0 ${r.history.length * 9} 40`} className="h-10 w-32 shrink-0" role="img" aria-label={`연도별 발생 시군 비율 ${r.history[0].year}~${r.year}`}>
          {r.history.map((h, k) => {
            const hh = Math.max(1.5, (h.v / maxV) * 38);
            return <rect key={h.year} x={k * 9 + 1} y={40 - hh} width={6} height={hh} rx={1.5} fill={k === r.history.length - 1 ? "#0f766e" : "#cbd5e1"} />;
          })}
        </svg>
      </div>

      <dl className="mt-3 space-y-1.5 px-5 text-xs">
        <div className="flex gap-2">
          <dt className="w-16 shrink-0 text-slate-400">심했던 곳</dt>
          <dd className="num text-slate-700">{r.top.map((t) => `${shortSgg(t.sigungu)} ${t.max}%`).join(" · ")}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-16 shrink-0 text-slate-400">가장 많던 때</dt>
          <dd className="num text-slate-700">{fmtMD(r.peak)} 조사</dd>
        </div>
      </dl>

      {winter && (
        <div className="mx-5 mt-3 rounded-xl bg-slate-50 px-3 py-2.5 text-xs leading-relaxed text-slate-600">
          <span className="font-semibold text-slate-700">겨울나기 </span>
          {winter}
          <span className="text-slate-400"> (NCPMS)</span>
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-slate-100 px-5 py-3 pt-3 text-xs">
        <Link href={`/survey?pest=${r.pest_id}`} className="link-arrow">
          시군별 지도 <Icon name="arrow" className="h-3.5 w-3.5" />
        </Link>
        <Link href={`/pests/${r.pest_id}?tab=control`} className="text-slate-500 hover:text-slate-800">
          방제 요령
        </Link>
      </div>
    </li>
  );
}

function CropCard({ c }: { c: CropGroup }) {
  const off = c.grown === 0;
  const accent = c.top ? gradeMeta(c.top).color : "#e2e8f0";
  return (
    <li className={`card flex flex-col overflow-hidden ${off ? "bg-slate-50/70" : ""}`}>
      <div className="h-1" style={{ background: off ? "transparent" : accent }} aria-hidden="true" />
      <div className="flex items-start justify-between gap-3 px-5 pt-4">
        <div className="min-w-0">
          <h3 className={`text-xl font-bold tracking-tight ${off ? "text-slate-500" : "text-slate-900"}`}>{c.crop_ko}</h3>
          <p className="num mt-0.5 text-xs text-slate-400">{off ? "지금은 재배 시기가 아니에요" : `재배 중 · 지점 ${c.grown}곳`}</p>
        </div>
        {off ? <span className="chip bg-white text-slate-400">재배 시기 아님</span> : <RiskBadge grade={c.top} />}
      </div>
      <ul className="mt-3 flex-1 divide-y divide-slate-100 border-t border-slate-100">
        {c.pests.map((p) => {
          const na = (p.n_applicable ?? 0) === 0;
          const n = alertN(p);
          const top = p.top_spots[0];
          const sub = na ? "재배 시기 아님" : n > 0 ? `주의보 이상 ${n}곳${top ? ` · 최고 ${top.name}` : ""}` : top ? `최고 ${top.name} ${Math.round(top.index)}` : "";
          return (
            <li key={p.pest_id}>
              <Link href={`/pests/${p.pest_id}`} className="flex items-center gap-3 px-5 py-3 transition hover:bg-slate-50">
                <div className="min-w-0 flex-1">
                  <div className={`truncate text-sm font-semibold ${na ? "text-slate-400" : "text-slate-800"}`}>{p.name_ko}</div>
                  <div className="num truncate text-xs text-slate-400">{sub}</div>
                </div>
                {!na && (
                  <span className="hidden sm:block">
                    <Sparkline values={p.trend_7d} width={64} height={24} label={`${p.name_ko} 전국 평균 위험지수 7일 추이`} />
                  </span>
                )}
                <div className="flex w-[4.75rem] shrink-0 justify-end">{na ? <span className="text-xs text-slate-300">–</span> : <RiskBadge grade={p.max_grade} size="sm" />}</div>
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="border-t border-slate-100 px-5 py-3">
        <Link href={`/map?crop=${c.crop}`} className="link-arrow text-xs">
          {c.crop_ko} 지도에서 보기 <Icon name="arrow" className="h-3.5 w-3.5" />
        </Link>
      </div>
    </li>
  );
}
