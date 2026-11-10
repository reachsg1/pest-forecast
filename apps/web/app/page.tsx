import Link from "next/link";
import RiskBadge from "@/components/RiskBadge";
import Sparkline from "@/components/Sparkline";
import { getSummary } from "@/lib/data";
import { CROP_LABEL, GRADES, gradeMeta } from "@/lib/grades";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ crop?: string }> }) {
  const { crop } = await searchParams;
  const summary = await getSummary();
  if (!summary) {
    return (
      <div className="rounded-lg border bg-white p-8 text-center">
        <h1 className="text-xl font-bold">아직 예측 데이터가 없습니다</h1>
        <p className="mt-2 text-gray-600">
          저장소에서 <code>python -m pipeline.cli run --demo</code> 를 실행해 <code>apps/web/public/data</code> 를 만든 뒤 다시 빌드하세요.
        </p>
      </div>
    );
  }
  const crops = Array.from(new Set(summary.pests.map((p) => p.crop)));
  const pests = crop ? summary.pests.filter((p) => p.crop === crop) : summary.pests;
  const counts = summary.grade_counts_all;

  return (
    <div className="space-y-8">
      <section aria-labelledby="today">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 id="today" className="text-2xl font-bold">
              오늘의 병해충 발생 위험 <span className="text-base font-normal text-gray-500">기준일 {summary.issued_date}</span>
            </h1>
            <p className="mt-1 text-sm text-gray-600">
              관측지점 {summary.n_spots}곳 × 병해충 {summary.n_models}종, {summary.horizon_days}일 전망 · 갱신 {summary.generated_at.replace("T", " ")}
            </p>
          </div>
          <Link href="/map" className="rounded bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark">
            예측 지도 열기
          </Link>
        </div>
        <ul className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="등급별 지점·병해충 조합 수">
          {GRADES.slice().reverse().map((g) => (
            <li key={g.name} className={`rounded-lg border p-4 ${g.bg}`}>
              <div className={`text-sm font-semibold ${g.text}`}>
                <span aria-hidden="true">{g.icon}</span> {g.name}
              </div>
              <div className="mt-1 text-3xl font-bold">{counts[g.name] ?? 0}</div>
              <div className="text-xs text-gray-600">{g.action}</div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="by-pest">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="by-pest" className="text-lg font-bold">
            병해충별 현황
          </h2>
          <nav aria-label="작물 선택" className="ml-auto flex gap-1">
            <Link href="/" className={`rounded-full px-3 py-1 text-sm ${!crop ? "bg-brand text-white" : "bg-white border"}`}>
              전체
            </Link>
            {crops.map((c) => (
              <Link key={c} href={`/?crop=${c}`} className={`rounded-full px-3 py-1 text-sm ${crop === c ? "bg-brand text-white" : "bg-white border"}`}>
                {CROP_LABEL[c] ?? c}
              </Link>
            ))}
          </nav>
        </div>
        <ul className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {pests.map((p) => {
            const m = gradeMeta(p.max_grade);
            return (
              <li key={p.pest_id} className="rounded-lg border bg-white p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-xs text-gray-500">{p.crop_ko} · 유형 {p.type}</div>
                    <Link href={`/pests/${p.pest_id}`} className="text-lg font-bold hover:underline">
                      {p.name_ko}
                    </Link>
                    {!p.in_season && <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">시즌 외</span>}
                  </div>
                  <RiskBadge grade={p.max_grade} />
                </div>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <dl className="flex gap-3 text-xs">
                    {GRADES.slice().reverse().map((g) => (
                      <div key={g.name} className="text-center">
                        <dt className={`${g.text}`}>{g.name}</dt>
                        <dd className="text-base font-semibold">{p.grade_counts[g.name] ?? 0}</dd>
                      </div>
                    ))}
                  </dl>
                  <Sparkline values={p.trend_7d} width={120} height={36} label={`${p.name_ko} 전국 평균 위험지수 7일 추이`} />
                </div>
                {p.top_spots.length > 0 && (
                  <p className="mt-2 truncate text-xs text-gray-600" style={{ borderLeft: `3px solid ${m.color}`, paddingLeft: 6 }}>
                    상위: {p.top_spots.slice(0, 3).map((s) => `${s.name} ${Math.round(s.index)}`).join(" · ")}
                  </p>
                )}
                <div className="mt-3 flex gap-2 text-sm">
                  <Link href={`/map?pest=${p.pest_id}`} className="rounded border px-3 py-1 hover:bg-gray-50">
                    지도
                  </Link>
                  <Link href={`/pests/${p.pest_id}`} className="rounded border px-3 py-1 hover:bg-gray-50">
                    상세·근거
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="rounded-lg border bg-white p-4 text-sm text-gray-700">
        <h2 className="font-bold">등급 읽는 법</h2>
        <ul className="mt-2 grid gap-1 md:grid-cols-2">
          {GRADES.map((g) => (
            <li key={g.name}>
              <RiskBadge grade={g.name} size="sm" /> 위험지수 {g.min}~{g.max}: {g.action}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-gray-500">
          위험지수는 각 병해충 모델이 기상 조건으로 계산한 0~100 값입니다. 모델 카드와 검증 지표는 병해충 상세 화면에서 볼 수 있습니다.
        </p>
      </section>
    </div>
  );
}
