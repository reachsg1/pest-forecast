import { TYPE_LABEL } from "@/lib/grades";
import type { PestCard } from "@/lib/types";

function Params({ value }: { value: unknown }) {
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v === "object" && v !== null)) {
      const cols = Array.from(new Set(value.flatMap((v) => Object.keys(v as object))));
      return (
        <table className="my-1 text-xs">
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c} className="border border-slate-200 bg-white px-2 py-1 text-left font-medium text-slate-500">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {value.map((row, i) => (
              <tr key={i}>
                {cols.map((c) => (
                  <td key={c} className="border border-slate-200 bg-white px-2 py-1 tabular-nums">
                    {String((row as Record<string, unknown>)[c] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    return <span>{value.map(String).join(", ")}</span>;
  }
  if (value && typeof value === "object") {
    return (
      <dl className="my-1 grid grid-cols-[auto_1fr] gap-x-3 text-xs">
        {Object.entries(value as Record<string, unknown>).map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-slate-500">{k}</dt>
            <dd>
              <Params value={v} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return <span className="tabular-nums">{String(value)}</span>;
}

export default function ModelCard({ pest }: { pest: PestCard }) {
  const rows: [string, React.ReactNode][] = [
    ["모델 유형", `${pest.type} · ${TYPE_LABEL[pest.type] ?? pest.type}`],
    ["버전·상태", `v${pest.version} · ${pest.status === "draft" ? "초안(담당자 검토 전)" : pest.status}${pest.owner ? ` · 담당 ${pest.owner}` : ""}`],
    ["적용 시기", `${pest.season.start_month}월 ~ ${pest.season.end_month}월 · 예측 전망 ${pest.horizon_days}일`],
    [
      "입력 변수",
      <span key="i" className="flex flex-wrap gap-1">
        {pest.inputs.map((x) => (
          <span key={x} className="chip">
            {x}
          </span>
        ))}
      </span>,
    ],
    ["발생 생태", pest.description || "-"],
    ["산정 논리", pest.logic || "-"],
  ];
  return (
    <div className="space-y-6 text-sm">
      <dl className="divide-y divide-slate-100 rounded-xl border border-slate-100">
        {rows.map(([k, v]) => (
          <div key={k} className="grid gap-1 px-4 py-3 md:grid-cols-[120px_1fr] md:gap-4">
            <dt className="text-xs font-semibold text-slate-500 md:pt-0.5">{k}</dt>
            <dd className="leading-relaxed text-slate-700">{v}</dd>
          </div>
        ))}
      </dl>
      <div>
        <h3 className="section-title text-sm">파라미터·임계값</h3>
        <div className="mt-2 overflow-x-auto rounded-xl bg-slate-50 p-4">
          <Params value={pest.params} />
        </div>
      </div>
      <div>
        <h3 className="section-title text-sm">근거 문헌</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-600">
          {pest.references.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </div>
      <p className="text-xs leading-relaxed text-slate-400">
        이 카드는 저장소의 <code>models/{pest.crop}/…/model.yaml</code> 을 그대로 표시합니다. 수정은 Pull Request로 제안하며, 변경 시 과거 자료로 자동 백테스트됩니다.
      </p>
    </div>
  );
}
