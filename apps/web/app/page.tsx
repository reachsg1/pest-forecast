import Link from "next/link";
import RiskBadge from "@/components/RiskBadge";
import Sparkline from "@/components/Sparkline";
import { GradeBar, Icon, PageHeader } from "@/components/ui";
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
      {/* 머리 */}
      <PageHeader
        eyebrow={`기준일 ${summary.issued_date} · ${summary.horizon_days}일 전망`}
        title="오늘의 병해충 발생 위험"
        desc={`관측지점 ${summary.n_spots}곳의 농업기상으로 병해충 ${summary.n_models}종의 발생 위험을 매일 계산합니다.`}
        actions={
          <>
            <Link href="/farm" className="btn-secondary">
              <Icon name="farm" /> 내 농장
            </Link>
            <Link href="/map" className="btn-primary">
              <Icon name="map" /> 예측 지도 열기
            </Link>
          </>
        }
      />

      {/* 전국 요약 */}
      <section aria-labelledby="overview" className="card overflow-hidden">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-5 sm:px-6 sm:pt-6">
          <h2 id="overview" className="section-title">
            전국 위험 현황
          </h2>
          <p className="num text-xs text-slate-400">
            지점 × 병해충 {applicable}건{na > 0 && ` · ${NA.label} ${na}건 제외`} · 갱신 {summary.generated_at.replace("T", " ")}
          </p>
        </div>
        <div className="px-5 pt-4 sm:px-6">
          <GradeBar counts={counts} naCount={na} legend={false} />
        </div>
        <ul className="mt-5 grid grid-cols-2 border-t border-slate-100 md:grid-cols-4" aria-label="등급별 지점·병해충 조합 수">
          {order.map((g, i) => {
            const n = counts[g.name] ?? 0;
            return (
              <li key={g.name} className={`px-5 py-5 sm:px-6 ${i % 2 === 1 ? "border-l" : ""} ${i >= 2 ? "border-t md:border-t-0" : ""} ${i === 2 ? "md:border-l" : ""} border-slate-100`}>
                <div className={`flex items-center gap-1.5 text-sm font-semibold ${g.text}`}>
                  <span aria-hidden="true" style={{ color: g.color }}>
                    {g.icon}
                  </span>
                  {g.name}
                </div>
                <div className="mt-2 flex items-baseline gap-1.5">
                  <span className="num text-3xl font-bold tracking-tight text-slate-900">{n}</span>
                  <span className="num text-xs text-slate-400">{applicable ? Math.round((n / applicable) * 100) : 0}%</span>
                </div>
                <div className="mt-1 text-xs text-slate-500">{g.action}</div>
              </li>
            );
          })}
        </ul>
        {na > 0 && (
          <p className="flex items-center gap-1.5 border-t border-slate-100 bg-slate-50/60 px-5 py-3 text-xs text-slate-500 sm:px-6">
            <Icon name="info" className="h-3.5 w-3.5 text-slate-400" />
            {NA.label} {na}건은 작물을 재배하지 않는 지역이거나 재배 시기가 아니어서 등급 집계에서 뺐습니다.
          </p>
        )}
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
