import Link from "next/link";
import RiskBadge from "@/components/RiskBadge";
import Sparkline from "@/components/Sparkline";
import { Icon } from "@/components/ui";
import { getSummary } from "@/lib/data";
import { CROP_LABEL, GRADES, gradeMeta } from "@/lib/grades";
import type { Grade, SummaryPest } from "@/lib/types";
import { fmtDate, fmtDateTime } from "@/lib/format";

type CropGroup = { crop: string; crop_ko: string; pests: SummaryPest[]; grown: number; top: Grade | null; alerts: number };

const ALERT: Grade[] = ["주의보", "경보"];
const alertN = (p: SummaryPest) => ALERT.reduce((a, g) => a + (p.grade_counts[g] ?? 0), 0);
const rank = (g: Grade | null) => (g ? GRADES.findIndex((x) => x.name === g) : -1);

/** 받침이 있으면 "은", 없으면 "는" */
function josa(word: string) {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  return code >= 0 && code <= 11171 && code % 28 !== 0 ? "은" : "는";
}

export default async function HomePage() {
  const summary = await getSummary();
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

  // 작물별 묶음: 재배 중인 작물 먼저, 그 안에서 위험 높은 순
  const crops: CropGroup[] = Array.from(new Set(summary.pests.map((p) => p.crop))).map((c) => {
    const ps = summary.pests.filter((p) => p.crop === c).sort((a, b) => rank(b.max_grade) - rank(a.max_grade) || alertN(b) - alertN(a));
    const grown = Math.max(0, ...ps.map((p) => p.n_applicable ?? 0));
    const top = ps.reduce<Grade | null>((m, p) => (rank(p.max_grade) > rank(m) ? p.max_grade : m), null);
    return { crop: c, crop_ko: ps[0]?.crop_ko ?? CROP_LABEL[c] ?? c, pests: ps, grown, top, alerts: ps.reduce((a, p) => a + alertN(p), 0) };
  });
  crops.sort((a, b) => Number(b.grown > 0) - Number(a.grown > 0) || rank(b.top) - rank(a.top) || b.alerts - a.alerts);

  const alerting = summary.pests.filter((p) => alertN(p) > 0).sort((a, b) => alertN(b) - alertN(a));
  const watching = summary.pests.reduce((a, p) => a + (p.grade_counts["예보"] ?? 0), 0);
  const offCrops = crops.filter((c) => c.grown === 0).map((c) => c.crop_ko);
  const offText =
    offCrops.length === 0 ? "" : `${offCrops.join("·")}${josa(offCrops[offCrops.length - 1])} 지금 재배 시기가 아니어서 위험도를 내지 않아요.`;

  return (
    <div className="space-y-10">
      {/* 히어로: 오늘의 결론 한 줄 */}
      <section aria-labelledby="today" className="hero-dark">
        {/* 한반도 위성 영상(장식). 개발용 Esri 영상, 운영 전 VWorld로 교체 */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 hidden w-[58%] bg-cover bg-center opacity-45 mix-blend-luminosity md:block"
          style={{
            backgroundImage:
              "url(https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=124.2,33.0,131.2,38.8&bboxSR=4326&imageSR=3857&size=900,860&format=jpg&f=image)",
            maskImage: "linear-gradient(to right, transparent 0%, black 45%, black 80%, transparent 100%), linear-gradient(to bottom, black 55%, transparent 95%)",
            maskComposite: "intersect",
            WebkitMaskImage: "linear-gradient(to right, transparent 0%, black 45%, black 80%, transparent 100%)",
          }}
        />
        <div className="relative px-6 pb-7 pt-8 sm:px-10 sm:pb-10 sm:pt-12">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium text-emerald-100 backdrop-blur">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            <span className="num">
              기준일 {fmtDate(summary.issued_date)} · {summary.horizon_days}일 전망
            </span>
          </span>
          <h1 id="today" className="mt-5 text-3xl font-bold leading-tight tracking-tight sm:text-5xl sm:leading-[1.1]">
            오늘의 병해충
            <br className="hidden sm:block" /> 발생 위험
          </h1>

          {/* 오늘의 결론 */}
          <div className="mt-6 max-w-2xl">
            {alerting.length > 0 ? (
              <>
                <p className="text-lg font-semibold sm:text-xl">
                  <span aria-hidden="true" style={{ color: gradeMeta("주의보").color }}>
                    {gradeMeta("주의보").icon}
                  </span>{" "}
                  주의보 이상인 병해충이 {alerting.length}종 있어요
                </p>
                <ul className="mt-3 flex flex-wrap gap-2" aria-label="주의보 이상 병해충">
                  {alerting.map((p) => (
                    <li key={p.pest_id}>
                      <Link href={`/map?crop=${p.crop}&pest=${p.pest_id}`} className="glass-tile inline-flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-white/15">
                        <span className="text-white/55">{p.crop_ko}</span>
                        <span className="font-semibold">{p.name_ko}</span>
                        <span className="num text-white/70">{alertN(p)}곳</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-lg font-semibold sm:text-xl">
                <span aria-hidden="true" className="text-emerald-300">
                  ○
                </span>{" "}
                오늘은 주의보 이상인 곳이 없어요
              </p>
            )}
            <p className="mt-2 text-sm leading-relaxed text-white/60">
              {watching > 0 ? `예보(관찰 강화) 단계 ${watching}건. ` : alerting.length === 0 ? "평소처럼 포장을 살펴보세요. " : ""}
              {offText}
            </p>
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
            <p className="max-w-xl text-xs leading-relaxed text-white/45">
              관측지점 {summary.n_spots}곳의 농업기상으로 작물 {crops.length}종, 병해충 {summary.n_models}종의 위험을 매일 계산합니다.
            </p>
            <div className="flex flex-wrap gap-2">
              <Link href="/farm" className="btn-glass">
                <Icon name="farm" /> 내 농장
              </Link>
              <Link href="/map" className="btn-light">
                <Icon name="map" /> 예측 지도 열기
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* 작물별 현황 */}
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

      {/* 등급 안내 */}
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
      {!off && (
        <p className="px-5 pt-2 text-sm text-slate-600">
          {c.alerts > 0 ? (
            <>
              주의보 이상 병해충 <b className="num text-slate-900">{c.pests.filter((p) => alertN(p) > 0).length}종</b> — 지도에서 지역을 확인하세요
            </>
          ) : (
            "주의보 이상인 곳 없음"
          )}
        </p>
      )}
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
