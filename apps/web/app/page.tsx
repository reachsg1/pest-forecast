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
      {/* ── 첫 화면(벤토) ─────────────────────────────────────
          왼쪽: 대표 타일(오늘의 한 줄 + 바로 가기) → 내 지역 → 등급·정확도, 오른쪽: 지도 타일 */}
      <section aria-labelledby="today" className="grid gap-4 break-keep lg:grid-cols-[minmax(0,1fr)_minmax(0,1.04fr)] lg:grid-rows-[auto_auto_1fr] lg:gap-5">
          {/* 모바일 순서: 대표 타일 → 지도 → 내 지역 → 등급·정확도 / 데스크톱: 왼쪽 세 칸 + 오른쪽 지도 */}
          <div className="tile-feature min-w-0 px-5 py-6 sm:px-8 sm:py-8 lg:col-start-1 lg:row-start-1">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/70 px-3 py-1 text-xs font-medium text-slate-600 backdrop-blur">
              <span className="relative flex h-2 w-2">
                {inSeason && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-50" />}
                <span className={`relative inline-flex h-2 w-2 rounded-full ${inSeason ? "bg-emerald-500" : "bg-[#9fb3a5]"}`} />
              </span>
              <span className="num">
                기준일 {fmtDate(summary.issued_date)} · {inSeason ? `${summary.horizon_days}일 전망` : "재배 시기 아님"}
              </span>
            </span>

            {inSeason ? (
              <>
                <h1 id="today" className="mt-5 text-[1.85rem] font-bold leading-[1.18] tracking-tight text-slate-900 sm:text-[2.5rem]">
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
                <p className="mt-3 text-[15px] leading-relaxed text-slate-600 sm:text-base">
                  {look && look.spots > 0 ? (
                    <>
                      앞으로 7일 안에 <b className="font-semibold text-slate-900">경보 예상 {look.spots}곳</b>
                      <span className="text-slate-500"> · {look.pests.slice(0, 2).map((p) => p.name).join(", ")}</span>
                    </>
                  ) : (
                    "앞으로 7일 동안 경보가 예상되는 곳은 없어요."
                  )}
                </p>
                {alerting.length > 0 && (
                  <ul className="mt-4 flex flex-wrap gap-2" aria-label="주의보 이상 병해충">
                    {alerting.slice(0, 4).map((p) => (
                      <li key={p.pest_id}>
                        <Link href={`/map?crop=${p.crop}&pest=${p.pest_id}`} className="inline-flex items-center gap-2 rounded-xl border border-white/80 bg-white/75 px-3 py-1.5 text-sm transition hover:bg-white">
                          <span className="text-slate-400">{p.crop_ko}</span>
                          <span className="font-semibold text-slate-900">{p.name_ko.replace(p.crop_ko, "").trim() || p.name_ko}</span>
                          <span className="num text-slate-500">{alertN(p)}곳</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : lead ? (
              <>
                <p className="mt-5 text-sm font-semibold text-brand-700">{lead.year} 시즌 돌아보기</p>
                <h1 id="today" className="mt-2 text-balance text-[1.85rem] font-bold leading-[1.18] tracking-tight text-slate-900 sm:text-[2.5rem]">
                  올해 {pestFullName(lead.crop_ko, lead.name_ko)},
                  <br />
                  조사한 시군 <span className="num text-[#d9730d]">{pct(lead.sggOcc)}</span>에서 발생했어요
                </h1>
                <p className="mt-3 text-[15px] leading-relaxed text-slate-600 sm:text-base">
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
              <h1 id="today" className="mt-5 text-3xl font-bold tracking-tight text-slate-900">
                오늘의 병해충 발생 위험
              </h1>
            )}

            <div className="mt-6 flex flex-wrap gap-2">
              <Link href="/map" className="btn-primary">
                <Icon name="map" /> 위험도 지도
              </Link>
              <Link href="/farm" className="btn border border-white/80 bg-white/75 text-slate-700 hover:bg-white">
                <Icon name="farm" /> 내 농장
              </Link>
              <ShareButton text={shareText} className="btn border border-white/80 bg-white/75 text-slate-700 hover:bg-white" />
            </div>
          </div>

          {mapProps && (
            <div className="tile min-w-0 p-4 sm:p-6 lg:col-start-2 lg:row-span-3 lg:row-start-1 lg:self-start">
              <HeroMap {...mapProps} />
            </div>
          )}

          <div className="min-w-0 lg:col-start-1 lg:row-start-2">
            <MyArea pests={pestLite} />
          </div>

          {/* 등급 읽는 법 + 예찰로 검증한 정확도 */}
          <div className="grid min-w-0 gap-4 self-start sm:grid-cols-2 lg:col-start-1 lg:row-start-3 lg:gap-5">
            <div className="tile p-5">
              <p className="text-[13px] font-semibold text-slate-800">등급 읽는 법</p>
              <p className="text-[11px] text-slate-400">위험지수 0~100</p>
              <ul className="mt-3 space-y-2">
                {GRADES.map((g) => (
                  <li key={g.name} className="flex items-center gap-2.5">
                    <span aria-hidden="true" className="w-3 text-center text-sm" style={{ color: g.color }}>
                      {g.icon}
                    </span>
                    <span className="w-11 shrink-0 whitespace-nowrap text-sm font-semibold text-slate-900">{g.name}</span>
                    <span className="num w-12 shrink-0 text-[11px] text-slate-400">
                      {g.min}~{g.max}
                    </span>
                    <span className="min-w-0 truncate text-xs text-slate-500">{g.action}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 border-t border-[#eef2ee] pt-2.5 text-[11px] leading-snug text-slate-400">&lsquo;해당 없음&rsquo; = 재배하지 않는 지역·기간(등급 아님)</p>
            </div>
            {acc.length > 0 && (
              <div className="tile p-5">
                <p className="text-[13px] font-semibold text-slate-800">예찰로 검증한 정확도</p>
                <p className="text-[11px] text-slate-400">AUC · {acc[0].testYears} 예찰(학습에 안 쓴 해)과 비교</p>
                <ul className="mt-3 space-y-2">
                  {acc.map((a) => (
                    <li key={a.pest_id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-[13px]">
                      <span className="truncate text-slate-600">{a.name}</span>
                      <b className="num font-semibold text-slate-900">{a.auc.toFixed(2)}</b>
                      <span className="col-span-2 h-[3px] overflow-hidden rounded-full bg-[#edf2ee]" aria-hidden="true">
                        <span className="block h-full rounded-full bg-[#9fb3a5]" style={{ width: `${Math.max(0, (a.auc - 0.5) / 0.5) * 100}%` }} />
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 border-t border-[#eef2ee] pt-2.5 text-[11px] leading-snug text-slate-400">1에 가까울수록 정확, 0.5는 찍기 수준</p>
              </div>
            )}
          </div>
      </section>
    </div>
  );
}
