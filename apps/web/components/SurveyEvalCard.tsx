import type { EvalSummary, ModelVariant } from "@/lib/types";

// 예찰 학습형 모델의 연도 분리 검증 — 기본 모델·계절 평균과 나란히 비교
export default function SurveyEvalCard({ model, defaultLabel }: { model: ModelVariant; defaultLabel: string }) {
  const ev = model.eval as EvalSummary;
  const t = ev.test;
  if (!t) return null;
  const hist = ev.with_history_reference?.test;

  type Row = { name: string; sub?: string; auc: number | null; within: number | null; brier: number | null; tone: "main" | "base" | "ref" };
  const rows: Row[] = [
    { name: model.label, sub: "이 모델 · 기상만 사용", auc: t.auc.survey_logit, within: t.within_round_auc.survey_logit, brier: t.brier.survey_logit, tone: "main" },
    { name: defaultLabel, sub: "현재 기본 모델", auc: t.auc.default_rule, within: t.within_round_auc.default_rule, brier: null, tone: "base" },
    { name: "계절 평균", sub: "조사 시기별 과거 발생률만", auc: t.auc.climatology, within: t.within_round_auc.climatology, brier: t.brier.climatology, tone: "base" },
  ];
  if (t.auc.persistence != null)
    rows.push({ name: "직전 회차 예찰값", sub: "참고 · 예찰 이력만", auc: t.auc.persistence, within: t.within_round_auc.persistence ?? null, brier: null, tone: "ref" });
  if (hist)
    rows.push({ name: `${model.label} + 직전 예찰값`, sub: "참고 · 예찰 실시간 연동 필요", auc: hist.auc.survey_logit, within: hist.within_round_auc.survey_logit, brier: hist.brier.survey_logit, tone: "ref" });

  const bar = (v: number | null) => {
    if (v == null || Number.isNaN(v)) return 0;
    return Math.max(0, Math.min(1, (v - 0.5) / 0.5)) * 100; // 0.5(무작위)~1.0(완벽)
  };
  const fmt = (v: number | null, d = 2) => (v == null || Number.isNaN(v) ? "–" : v.toFixed(d));

  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-slate-900">{model.label} 검증 · 학습에 쓰지 않은 해로 시험</div>
          <p className="mt-0.5 text-xs text-slate-500">
            {ev.method ?? "연도 분리 검증"} · 시군 {ev.n_sigungu ?? "–"}곳 · 시험 {t.n.toLocaleString()}건(발생 {Math.round(t.positive_rate * 100)}%)
          </p>
        </div>
      </div>

      <div className="mt-4">
        <div className="hidden grid-cols-[minmax(0,1.3fr)_minmax(0,1.4fr)_5.5rem_4.5rem] gap-3 border-b border-slate-100 pb-2 text-[11px] font-semibold text-slate-400 sm:grid">
          <span>모델·기준</span>
          <span>전체 변별력 (AUC)</span>
          <span className="text-right">같은 회차 변별력</span>
          <span className="text-right">Brier ↓</span>
        </div>
        <ul className="divide-y divide-slate-100">
          {rows.map((r) => (
            <li key={r.name} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 py-3 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1.4fr)_5.5rem_4.5rem] sm:items-center">
              <div className="min-w-0">
                <div className={`truncate text-sm font-medium ${r.tone === "main" ? "text-brand-800" : r.tone === "ref" ? "text-slate-600" : "text-slate-800"}`}>{r.name}</div>
                {r.sub && <div className="truncate text-[11px] text-slate-400">{r.sub}</div>}
              </div>
              <div className="col-span-2 row-start-2 flex items-center gap-2 sm:col-span-1 sm:row-start-auto">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
                  <div className={`h-full rounded-full ${r.tone === "main" ? "bg-brand-600" : r.tone === "ref" ? "bg-slate-300" : "bg-slate-400"}`} style={{ width: `${bar(r.auc)}%` }} />
                </div>
                <span className={`num w-9 text-right text-sm font-semibold ${r.tone === "ref" ? "text-slate-500" : "text-slate-900"}`}>{fmt(r.auc)}</span>
              </div>
              <div className="num col-start-2 row-start-1 self-start text-right text-[11px] text-slate-500 sm:hidden">
                같은 회차 {fmt(r.within)}
                <br />
                Brier {fmt(r.brier, 3)}
              </div>
              <span className="num hidden text-right text-sm text-slate-700 sm:block">{fmt(r.within)}</span>
              <span className="num hidden text-right text-sm text-slate-700 sm:block">{fmt(r.brier, 3)}</span>
            </li>
          ))}
        </ul>
      </div>

      {ev.test_by_year && (
        <div className="mt-4 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
          <span className="mr-1">연도별 AUC</span>
          {Object.entries(ev.test_by_year).map(([y, v]) => (
            <span key={y} className="chip num">
              {y} · {fmt(v.auc.survey_logit)}
              <span className="text-slate-400">(기본 {fmt(v.auc.default_rule)})</span>
            </span>
          ))}
        </div>
      )}

      <ul className="mt-4 space-y-1 text-xs leading-relaxed text-slate-500">
        <li>· AUC는 발생한 곳과 안 한 곳을 가르는 힘입니다. 1.0이면 완벽, 0.5면 무작위와 같습니다. Brier는 확률 오차로 낮을수록 좋습니다.</li>
        <li>· &lsquo;같은 회차 변별력&rsquo;은 같은 조사일의 시군끼리만 비교한 값으로, 시기(계절)를 맞힌 효과를 뺀 성능입니다.</li>
        <li>· 정답은 NCPMS 시군구 예찰 피해과율이 0보다 큰지이며, 같은 시군 이름의 농업기상 관측소와 짝지었습니다.</li>
      </ul>
    </div>
  );
}
