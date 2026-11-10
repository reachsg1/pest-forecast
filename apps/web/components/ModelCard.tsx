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
                <th key={c} className="border px-2 py-0.5 text-left font-medium">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {value.map((row, i) => (
              <tr key={i}>
                {cols.map((c) => (
                  <td key={c} className="border px-2 py-0.5 tabular-nums">
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
            <dt className="text-gray-600">{k}</dt>
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
  return (
    <div className="space-y-4 text-sm">
      <dl className="grid gap-x-4 gap-y-1 md:grid-cols-[auto_1fr]">
        <dt className="font-semibold text-gray-700">모델 유형</dt>
        <dd>
          {pest.type} · {TYPE_LABEL[pest.type] ?? pest.type}
        </dd>
        <dt className="font-semibold text-gray-700">버전·상태</dt>
        <dd>
          v{pest.version} · {pest.status === "draft" ? "초안(담당자 검토 전)" : pest.status}
          {pest.owner && ` · 담당 ${pest.owner}`}
        </dd>
        <dt className="font-semibold text-gray-700">적용 시기</dt>
        <dd>
          {pest.season.start_month}월 ~ {pest.season.end_month}월 · 예측 전망 {pest.horizon_days}일
        </dd>
        <dt className="font-semibold text-gray-700">입력 변수</dt>
        <dd>{pest.inputs.join(", ")}</dd>
        <dt className="font-semibold text-gray-700">발생 생태</dt>
        <dd>{pest.description || "-"}</dd>
        <dt className="font-semibold text-gray-700">산정 논리</dt>
        <dd>{pest.logic || "-"}</dd>
      </dl>
      <div>
        <h3 className="font-semibold text-gray-700">파라미터·임계값</h3>
        <div className="mt-1 rounded border bg-gray-50 p-3">
          <Params value={pest.params} />
        </div>
      </div>
      <div>
        <h3 className="font-semibold text-gray-700">근거 문헌</h3>
        <ul className="mt-1 list-disc pl-5 text-gray-700">
          {pest.references.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </div>
      <p className="text-xs text-gray-500">
        이 카드는 저장소의 <code>models/{pest.crop}/…/model.yaml</code> 을 그대로 표시합니다. 수정은 Pull Request로 제안하며, 변경 시 과거 자료로 자동 백테스트됩니다.
      </p>
    </div>
  );
}
