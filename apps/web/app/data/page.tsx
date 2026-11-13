import type { Metadata } from "next";
import ModelFeatures from "@/components/ModelFeatures";
import { PageHeader } from "@/components/ui";
import { getPests, getStatus } from "@/lib/data";

export const metadata: Metadata = { title: "데이터 명세" };

const ENDPOINTS = [
  { m: "GET", p: "/api/v1/status", d: "배치 상태(기준일, 지점·모델 수, 결측률, 경고)" },
  { m: "GET", p: "/api/v1/spots", d: "관측지점 목록(좌표, 시군, 자료 부족 여부)" },
  { m: "GET", p: "/api/v1/pests", d: "병해충 목록 + 모델 카드 + 검증 요약" },
  { m: "GET", p: "/api/v1/pests/{pest_id}", d: "병해충 1종 상세" },
  { m: "GET", p: "/api/v1/risk?pest={pest_id}&offset={0..10}[&format=csv]", d: "지도용 지점별 위험도(오늘+offset일). index가 null이면 해당 없음(na_reason에 사유)" },
  { m: "GET", p: "/api/v1/risk/spot/{spot_code}[?pest={pest_id}]", d: "지점의 병해충별 일자 시계열(과거 30일+전망) + 입력 기상" },
  { m: "GET", p: "/api/v1/risk/nearest?lat=&lon=&crop=", d: "좌표에서 가장 가까운 지점의 위험도(농장 맞춤)" },
];

const FILES = [
  { p: "/data/summary.json", d: "홈 요약", link: true },
  { p: "/data/spots.json", d: "관측지점", link: true },
  { p: "/data/pests.json", d: "모델 카드", link: true },
  { p: "/data/risk/<pest_id>.json", d: "병해충별 지점 위험도", link: false },
  { p: "/data/spot/<spot_code>.json", d: "지점별 시계열·기상", link: false },
  { p: "data/predictions/YYYY-MM-DD.csv", d: "일별 스냅샷(저장소)", link: false },
];

export default async function DataPage() {
  const [status, pests] = await Promise.all([getStatus(), getPests()]);
  const pid = pests[0]?.pest_id ?? "apple_anthracnose";
  return (
    <div className="max-w-5xl space-y-8">
      <PageHeader
        eyebrow="관리자"
        title="데이터 명세"
        desc="모델이 어떤 자료로 무엇을 계산하는지(입력 변수·출처·중요도), 결과를 가져가는 API를 한곳에 정리했어요."
      />

      <ModelFeatures pests={pests} />

      <div className="border-t border-slate-200 pt-6">
        <h2 className="text-lg font-bold tracking-tight text-slate-900">결과 API</h2>
        <p className="mt-1 text-sm text-slate-500">예측 결과를 JSON으로 제공해요. 응답은 1시간 캐시되고, 공공누리 제1유형(출처표시)으로 이용할 수 있어요.</p>
      </div>

      <section className="card overflow-hidden">
        <h2 className="section-title px-5 pt-5 sm:px-6">엔드포인트</h2>
        <ul className="mt-3 divide-y divide-slate-100 border-t border-slate-100">
          {ENDPOINTS.map((e) => (
            <li key={e.p} className="flex flex-col gap-1.5 px-5 py-3.5 sm:flex-row sm:items-start sm:gap-4 sm:px-6">
              <span className="w-fit shrink-0 rounded-md bg-emerald-50 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">{e.m}</span>
              <div className="min-w-0 flex-1">
                {e.p.includes("{") ? (
                  <code className="break-all font-mono text-[13px] text-slate-900">{e.p}</code>
                ) : (
                  <a href={e.p} className="break-all font-mono text-[13px] text-brand-700 hover:underline">
                    {e.p}
                  </a>
                )}
                <p className="mt-0.5 text-xs text-slate-500">{e.d}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="section-title">호출 예시</h2>
        <pre className="overflow-x-auto rounded-2xl bg-slate-900 p-5 font-mono text-xs leading-relaxed text-slate-100 shadow-card">
          <span className="text-slate-400">$ </span>
          {`curl "https://<배포주소>/api/v1/risk?pest=${pid}&offset=3"

{
  "pest_id": "${pid}",
  "issued_date": "${status?.issued_date ?? "2026-07-15"}",
  "offset": 3,
  "spots": [
    { "spot_code": "...", "name": "...", "lat": 36.5, "lon": 127.5, "index": 62.0, "grade": "주의보", "na_reason": null },
    { "spot_code": "...", "name": "...", "index": null, "grade": null, "na_reason": "not_grown" }
  ]
}`}
        </pre>
      </section>

      <div className="grid gap-5 md:grid-cols-2">
        <section className="card card-pad">
          <h2 className="section-title">정적 파일</h2>
          <ul className="mt-3 space-y-2.5 text-sm">
            {FILES.map((f) => (
              <li key={f.p} className="flex items-baseline justify-between gap-3">
                {f.link ? (
                  <a className="font-mono text-[13px] text-brand-700 hover:underline" href={f.p}>
                    {f.p}
                  </a>
                ) : (
                  <code className="font-mono text-[13px] text-slate-700">{f.p}</code>
                )}
                <span className="shrink-0 text-xs text-slate-400">{f.d}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="card card-pad">
          <h2 className="section-title">이용 조건</h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            출처(농촌진흥청 병해충 발생 예측 서비스)를 표시하면 상업적 이용·변경이 가능합니다. 대량 호출이 필요하면 API 키 발급(2단계)을 신청해 주세요.
          </p>
        </section>
      </div>
    </div>
  );
}
