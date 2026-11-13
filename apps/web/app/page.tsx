import Link from "next/link";
import HeroMap, { type HeroMapProps } from "@/components/HeroMap";
import MyArea from "@/components/MyArea";
import ShareButton from "@/components/ShareButton";
import { Icon } from "@/components/ui";
import { getPests, getSummary } from "@/lib/data";
import { GRADES, gradeMeta, pestFullName } from "@/lib/grades";
import { accuracies, outlook, seasonRecaps } from "@/lib/home";
import type { Grade, SummaryPest } from "@/lib/types";
import { fmtDate, fmtMD } from "@/lib/format";

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

  const inSeason = summary.pests.some((p) => (p.n_applicable ?? 0) > 0);
  const alerting = summary.pests.filter((p) => alertN(p) > 0).sort((a, b) => alertN(b) - alertN(a));
  const [recaps, acc, look] = await Promise.all([seasonRecaps(pests), Promise.resolve(accuracies(pests)), inSeason ? outlook(summary) : Promise.resolve(null)]);
  const alertSpots = look?.todayAlert ?? 0; // 병해충이 겹쳐도 한 곳으로 센 관측지점 수
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
    <div className="lg:-mt-3">
      {/* ── 히어로 ─────────────────────────────────────────── */}
      <section aria-labelledby="today" className="hero-dark">
        <div className="relative grid gap-5 px-5 py-6 sm:px-10 sm:py-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:grid-rows-[auto_1fr] lg:gap-x-10 lg:gap-y-4 lg:py-6">
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
                <h1 id="today" className="mt-4 text-3xl font-bold leading-tight tracking-tight sm:text-[2.4rem] sm:leading-[1.15]">
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
                <p className="mt-4 text-sm font-medium text-emerald-200">{lead.year} 시즌 돌아보기</p>
                <h1 id="today" className="mt-1.5 text-balance text-[1.7rem] font-bold leading-tight tracking-tight sm:text-[2.2rem] sm:leading-[1.2]">
                  올해 {pestFullName(lead.crop_ko, lead.name_ko)},
                  <br />
                  조사한 시군 <span className="num text-amber-300">{pct(lead.sggOcc)}</span>에서 발생했어요
                </h1>
                <p className="mt-2.5 text-sm leading-relaxed text-white/75 sm:text-base">
                  {lead.normal != null && (
                    <>
                      평년({lead.normalYears}) {pct(lead.normal)}
                      {lead.vsNormal === "비슷" ? "과 비슷했고" : lead.vsNormal === "높음" ? "보다 높았고" : "보다 낮았고"},{" "}
                    </>
                  )}
                  가장 심했던 곳은 {lead.top.slice(0, 2).map((t) => `${shortSgg(t.sigungu)}(${t.max}%)`).join(", ")}예요.
                </p>
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

            <div className="mt-4 flex flex-wrap gap-2">
              <Link href="/map" className="btn-light">
                <Icon name="map" /> 위험도 지도
              </Link>
              <Link href="/farm" className="btn-glass">
                <Icon name="farm" /> 내 농장
              </Link>
              <ShareButton text={shareText} />
            </div>

            {/* 등급 읽는 법 + 예찰로 검증한 정확도(왼쪽 열 아래를 채움) */}
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3.5">
                <p className="text-xs font-semibold text-white/70">등급 읽는 법 · 위험지수 0~100</p>
                <ul className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2.5">
                  {GRADES.map((g) => (
                    <li key={g.name} className="min-w-0">
                      <div className="flex items-baseline gap-1.5 text-sm font-semibold">
                        <span aria-hidden="true" style={{ color: g.color }}>
                          {g.icon}
                        </span>
                        {g.name}
                        <span className="num text-[11px] font-normal text-white/45">
                          {g.min}~{g.max}
                        </span>
                      </div>
                      <div className="truncate text-[11px] text-white/55">{g.action}</div>
                    </li>
                  ))}
                </ul>
                <p className="mt-2.5 text-[11px] leading-snug text-white/45">&lsquo;해당 없음&rsquo; = 재배하지 않는 지역·기간(등급 아님)</p>
              </div>
              {acc.length > 0 && (
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3.5">
                  <p className="text-xs font-semibold text-white/70">예찰로 검증한 정확도(AUC)</p>
                  <ul className="mt-2.5 space-y-1.5">
                    {acc.map((a) => (
                      <li key={a.pest_id} className="grid grid-cols-[1fr_auto] items-center gap-x-2 text-[13px]">
                        <span className="truncate text-white/70">{a.name}</span>
                        <b className="num">{a.auc.toFixed(2)}</b>
                        <span className="col-span-2 h-1 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
                          <span className="block h-full rounded-full bg-emerald-300/80" style={{ width: `${Math.max(0, (a.auc - 0.5) / 0.5) * 100}%` }} />
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2.5 text-[11px] leading-snug text-white/45">1에 가까울수록 정확, 0.5는 찍기 수준. {acc[0].testYears} 예찰(학습에 안 쓴 해)과 비교.</p>
                </div>
              )}
            </div>
          </div>
        </div>

      </section>

    </div>
  );
}
