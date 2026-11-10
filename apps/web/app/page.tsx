import Link from "next/link";
import RiskBadge from "@/components/RiskBadge";
import Sparkline from "@/components/Sparkline";
import { GradeBar, Icon } from "@/components/ui";
import { getSummary } from "@/lib/data";
import { CROP_LABEL, GRADES, NA, gradeMeta } from "@/lib/grades";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ crop?: string }> }) {
  const { crop } = await searchParams;
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
  const crops = Array.from(new Set(summary.pests.map((p) => p.crop)));
  const pests = crop ? summary.pests.filter((p) => p.crop === crop) : summary.pests;
  const counts = summary.grade_counts_all;
  const na = summary.na_all ?? 0;
  const applicable = GRADES.reduce((a, g) => a + (counts[g.name] ?? 0), 0);
  const order = GRADES.slice().reverse();

  return (
    <div className="space-y-10">
      {/* 히어로: 오늘의 전국 위험 */}
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
        <div className="relative px-6 pb-6 pt-8 sm:px-10 sm:pb-8 sm:pt-12">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div className="max-w-2xl">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium text-emerald-100 backdrop-blur">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                </span>
                <span className="num">
                  기준일 {summary.issued_date} · {summary.horizon_days}일 전망
                </span>
              </span>
              <h1 id="today" className="mt-5 text-3xl font-bold leading-tight tracking-tight sm:text-5xl sm:leading-[1.1]">
                오늘의 병해충
                <br className="hidden sm:block" /> 발생 위험
              </h1>
              <p className="mt-4 max-w-xl text-sm leading-relaxed text-white/65 sm:text-base">
                관측지점 {summary.n_spots}곳의 농업기상으로 병해충 {summary.n_models}종의 발생 위험을 매일 계산합니다. 작물을 재배하지 않는 지역·시기는 자동으로 제외합니다.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/farm" className="btn-glass">
                <Icon name="farm" /> 내 농장
              </Link>
              <Link href="/map" className="btn-light">
                <Icon name="map" /> 예측 지도 열기
              </Link>
            </div>
          </div>

          {/* 분포 막대 */}
          <div className="mt-10">
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-white/55">
              <span className="font-medium text-white/80">전국 위험 분포</span>
              <span className="num">
                지점 × 병해충 {applicable}건{na > 0 && ` · ${NA.label} ${na}건 제외`}
              </span>
            </div>
            <div className="mt-2.5 flex h-2.5 w-full overflow-hidden rounded-full bg-white/10" role="img" aria-label={order.map((g) => `${g.name} ${counts[g.name] ?? 0}`).join(", ")}>
              {order.map((g) => ((counts[g.name] ?? 0) > 0 ? <span key={g.name} style={{ width: `${((counts[g.name] ?? 0) / Math.max(1, applicable)) * 100}%`, background: g.color }} /> : null))}
            </div>
          </div>

          {/* 등급 타일 */}
          <ul className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="등급별 지점·병해충 조합 수">
            {order.map((g) => {
              const n = counts[g.name] ?? 0;
              return (
                <li key={g.name} className="glass-tile p-4 sm:p-5">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-sm font-semibold text-white/90">
                      <span aria-hidden="true" style={{ color: g.color }}>
                        {g.icon}
                      </span>
                      {g.name}
                    </span>
                    <span className="num text-xs text-white/45">{applicable ? Math.round((n / applicable) * 100) : 0}%</span>
                  </div>
                  <div className="num mt-3 text-4xl font-bold tracking-tight">{n}</div>
                  <div className="mt-1 text-xs text-white/55">{g.action}</div>
                </li>
              );
            })}
          </ul>

          <p className="num mt-5 flex flex-wrap items-center gap-x-1.5 text-xs text-white/40">
            {na > 0 && (
              <>
                <Icon name="info" className="h-3.5 w-3.5" /> {NA.label} {na}건은 비재배지·재배 시기 아님으로 집계에서 제외 ·
              </>
            )}
            갱신 {summary.generated_at.replace("T", " ")}
          </p>
        </div>
      </section>

      {/* 병해충별 */}
      <section aria-labelledby="by-pest" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="by-pest" className="section-title text-lg">
            병해충별 현황
          </h2>
          <nav aria-label="작물 선택" className="segmented">
            <Link href="/" aria-current={!crop ? "page" : undefined} className="segmented-item">
              전체
            </Link>
            {crops.map((c) => (
              <Link key={c} href={`/?crop=${c}`} aria-current={crop === c ? "page" : undefined} className="segmented-item">
                {CROP_LABEL[c] ?? c}
              </Link>
            ))}
          </nav>
        </div>
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {pests.map((p) => {
            const accent = p.max_grade ? gradeMeta(p.max_grade).color : NA.color;
            return (
              <li key={p.pest_id} className="card card-hover group relative flex flex-col p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="chip">{p.crop_ko}</span>
                      <span className="text-xs text-slate-400">유형 {p.type}</span>
                      {!p.in_season && <span className="chip bg-slate-50 text-slate-400">시즌 외</span>}
                    </div>
                    <h3 className="mt-2 text-lg font-bold tracking-tight">
                      <Link href={`/pests/${p.pest_id}`} className="after:absolute after:inset-0 after:rounded-2xl">
                        {p.name_ko}
                      </Link>
                    </h3>
                  </div>
                  <RiskBadge grade={p.max_grade} />
                </div>

                <div className="mt-4 flex items-end justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <GradeBar counts={p.grade_counts} naCount={p.na_count ?? 0} compact />
                  </div>
                  <div className="shrink-0 text-right">
                    <Sparkline values={p.trend_7d} width={96} height={34} label={`${p.name_ko} 전국 평균 위험지수 7일 추이`} />
                    <div className="text-[10px] text-slate-400">7일 추이</div>
                  </div>
                </div>

                {p.top_spots.length > 0 && (
                  <p className="mt-4 truncate border-l-2 pl-2.5 text-xs text-slate-500" style={{ borderColor: accent }}>
                    <span className="font-medium text-slate-700">위험 상위</span> {p.top_spots.slice(0, 3).map((s) => `${s.name} ${Math.round(s.index)}`).join(" · ")}
                  </p>
                )}

                <div className="relative z-10 mt-4 flex items-center gap-4 border-t border-slate-100 pt-3">
                  <Link href={`/map?pest=${p.pest_id}`} className="link-arrow text-xs">
                    지도에서 보기 <Icon name="arrow" className="h-3.5 w-3.5" />
                  </Link>
                  <Link href={`/pests/${p.pest_id}`} className="text-xs font-medium text-slate-500 hover:text-slate-900">
                    상세·예측 근거
                  </Link>
                </div>
              </li>
            );
          })}
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
