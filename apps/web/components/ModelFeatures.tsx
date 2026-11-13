import { pestFullName } from "@/lib/grades";
import { FEATURES, FEATURE_BY_CODE, GROUPS, groupOf, pestFeatureCodes, type FeatureGroup } from "@/lib/features";
import type { PestCard } from "@/lib/types";

/** 관리자 '데이터 명세': 원자료 묶음 → 병해충별 모델 입력·변수 중요도 → 변수 사전. */
const ORDER: FeatureGroup[] = ["agri", "asos", "survey", "terrain", "season"];

function GroupChip({ g, n }: { g: FeatureGroup; n?: number }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${GROUPS[g].tone}`}>
      {GROUPS[g].name}
      {n != null && <span className="num font-medium opacity-70">{n}</span>}
    </span>
  );
}

// 규칙형 모델 카드 inputs(일 기상 항목) → 한글
const RAW: Record<string, string> = {
  tavg: "평균기온", tmin: "최저기온", tmax: "최고기온", rain: "강수량", rh: "상대습도", sunshine: "일조시간",
  "lwd_hours(추정)": "잎 젖음 시간(습도·강우로 추정)", lwd_hours: "잎 젖음 시간",
};
const rawLabel = (x: string) => RAW[x] ?? FEATURE_BY_CODE.get(x)?.name ?? x;

function label(code: string) {
  const f = FEATURE_BY_CODE.get(code);
  return f ? `${f.name} · ${f.calc.replace(/^최근 /, "")}` : code;
}

export default function ModelFeatures({ pests }: { pests: PestCard[] }) {
  const usedBy = new Map<string, string[]>();
  const rows = pests.map((p) => {
    const codes = pestFeatureCodes(p);
    codes.forEach((c) => usedBy.set(c, [...(usedBy.get(c) ?? []), pestFullName(p.crop_ko, p.name_ko)]));
    const counts = new Map<FeatureGroup, number>();
    codes.forEach((c) => counts.set(groupOf(c), (counts.get(groupOf(c)) ?? 0) + 1));
    const def = p.models?.find((m) => m.is_default) ?? p.models?.[0];
    const rf = p.models?.find((m) => m.model_id.endsWith("__survey_rf"));
    return { p, codes, counts, def, rf, imp: rf?.eval?.importance };
  });
  const extra = Array.from(usedBy.keys()).filter((c) => !FEATURE_BY_CODE.has(c));

  return (
    <div className="space-y-6">
      {/* 원자료 */}
      <section>
        <h2 className="section-title">원자료</h2>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ORDER.filter((g) => g !== "season").map((g) => (
            <li key={g} className="card p-4">
              <GroupChip g={g} n={FEATURES.filter((f) => f.group === g).length} />
              <p className="mt-2 text-sm font-semibold text-slate-900">{GROUPS[g].source}</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">{GROUPS[g].detail}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* 병해충별 */}
      <section className="card overflow-hidden">
        <div className="px-5 pt-5 sm:px-6">
          <h2 className="section-title">병해충별 모델 입력</h2>
          <p className="mt-1 text-xs text-slate-500">
            학습 모델(로지스틱·Random Forest·XGBoost)이 쓰는 변수. 중요도는 Random Forest가 판단에 쓴 비중(합 100%)이에요. 규칙형 모델은 정해진 식에 기상값을 넣어요.
          </p>
        </div>
        <ul className="mt-3 divide-y divide-slate-100 border-t border-slate-100">
          {rows.map(({ p, codes, counts, def, imp }) => (
            <li key={p.pest_id} className="grid gap-3 px-5 py-4 sm:px-6 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] lg:gap-6">
              <div className="min-w-0">
                <p className="font-semibold text-slate-900">{pestFullName(p.crop_ko, p.name_ko)}</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  기본 모델 {def?.label ?? p.label ?? p.type}
                  {codes.length > 0 && <> · 변수 {codes.length}개</>}
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {codes.length > 0
                    ? ORDER.filter((g) => counts.get(g)).map((g) => <GroupChip key={g} g={g} n={counts.get(g)} />)
                    : <GroupChip g="agri" />}
                </div>
              </div>
              <div className="min-w-0">
                {imp && imp.values.length > 0 ? (
                  <ol className="space-y-1.5">
                    {imp.values.slice(0, 6).map((v) => (
                      <li key={v.feature} className="grid grid-cols-[minmax(0,1fr)_7rem_3rem] items-center gap-3 text-xs sm:grid-cols-[minmax(0,1fr)_10rem_3rem]">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${GROUPS[groupOf(v.feature)].dot}`} />
                          <span className="truncate text-slate-700" title={v.feature}>{label(v.feature)}</span>
                        </span>
                        <span className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                          <span className="block h-full rounded-full bg-brand-500" style={{ width: `${Math.min(100, (v.share / imp.values[0].share) * 100)}%` }} />
                        </span>
                        <span className="num text-right text-slate-500">{(v.share * 100).toFixed(1)}%</span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-xs leading-relaxed text-slate-500">
                    {codes.length > 0 ? `변수: ${codes.map(label).join(", ")}` : `일 기상 입력: ${p.inputs.map(rawLabel).join(", ")}`}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* 변수 사전 */}
      <section className="card overflow-hidden">
        <div className="px-5 pt-5 sm:px-6">
          <h2 className="section-title">변수 사전</h2>
          <p className="mt-1 text-xs text-slate-500">모두 예측하는 날의 전날까지 자료로 계산해요(그날 값은 쓰지 않음).</p>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="table-clean">
            <thead>
              <tr>
                <th className="pl-5 sm:pl-6">변수</th>
                <th>계산</th>
                <th className="hidden md:table-cell">단위</th>
                <th className="pr-5 sm:pr-6">쓰는 병해충</th>
              </tr>
            </thead>
            <tbody>
              {ORDER.flatMap((g) => [
                <tr key={`h-${g}`} className="hover:bg-transparent">
                  <td colSpan={4} className="bg-slate-50/80 pl-5 sm:pl-6">
                    <GroupChip g={g} />
                  </td>
                </tr>,
                ...FEATURES.filter((f) => f.group === g).map((f) => {
                  const by = usedBy.get(f.code) ?? [];
                  return (
                    <tr key={f.code}>
                      <td className="pl-5 sm:pl-6">
                        <span className="block font-medium text-slate-900">{f.name}</span>
                        <code className="font-mono text-[11px] text-slate-400">{f.code}</code>
                      </td>
                      <td className="text-xs text-slate-600">{f.calc}</td>
                      <td className="hidden whitespace-nowrap text-xs text-slate-500 md:table-cell">{f.unit || "—"}</td>
                      <td className="pr-5 text-xs sm:pr-6">
                        {by.length ? <span className="text-slate-600">{by.join(", ")}</span> : <span className="text-slate-400">아직 안 씀</span>}
                      </td>
                    </tr>
                  );
                }),
              ])}
              {extra.length > 0 && (
                <tr>
                  <td colSpan={4} className="pl-5 text-xs text-slate-500 sm:pl-6">
                    사전에 없는 변수: <code className="font-mono">{extra.join(", ")}</code>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

