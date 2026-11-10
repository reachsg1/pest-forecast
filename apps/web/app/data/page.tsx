import type { Metadata } from "next";
import { getPests, getStatus } from "@/lib/data";

export const metadata: Metadata = { title: "데이터·API" };

const ENDPOINTS = [
  { m: "GET", p: "/api/v1/status", d: "배치 상태(기준일, 지점·모델 수, 결측률, 경고)" },
  { m: "GET", p: "/api/v1/spots", d: "관측지점 목록(좌표, 시군, 자료 부족 여부)" },
  { m: "GET", p: "/api/v1/pests", d: "병해충 목록 + 모델 카드 + 검증 요약" },
  { m: "GET", p: "/api/v1/pests/{pest_id}", d: "병해충 1종 상세" },
  { m: "GET", p: "/api/v1/risk?pest={pest_id}&offset={0..10}[&format=csv]", d: "지도용 지점별 위험도(오늘+offset일)" },
  { m: "GET", p: "/api/v1/risk/spot/{spot_code}[?pest={pest_id}]", d: "지점의 병해충별 일자 시계열(과거 30일+전망) + 입력 기상" },
  { m: "GET", p: "/api/v1/risk/nearest?lat=&lon=&crop=", d: "좌표에서 가장 가까운 지점의 위험도(농장 맞춤)" },
];

export default async function DataPage() {
  const [status, pests] = await Promise.all([getStatus(), getPests()]);
  return (
    <div className="max-w-4xl space-y-6">
      <section>
        <h1 className="text-xl font-bold">Open API · 데이터 다운로드</h1>
        <p className="mt-1 text-sm text-gray-700">
          예측 결과를 JSON으로 재개방합니다. 인증 없이 사용할 수 있으며(1단계), 응답은 1시간 캐시됩니다. 공공누리 제1유형(출처표시)으로 이용하세요.
        </p>
      </section>
      <section>
        <h2 className="text-lg font-bold">엔드포인트</h2>
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-gray-600">
              <th className="py-1 pr-2">메서드</th>
              <th className="py-1 pr-2">경로</th>
              <th className="py-1">설명</th>
            </tr>
          </thead>
          <tbody>
            {ENDPOINTS.map((e) => (
              <tr key={e.p} className="border-b align-top">
                <td className="py-1 pr-2 font-mono text-xs">{e.m}</td>
                <td className="py-1 pr-2 font-mono text-xs">
                  <a className="underline" href={e.p.includes("{") ? undefined : e.p}>
                    {e.p}
                  </a>
                </td>
                <td className="py-1">{e.d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section>
        <h2 className="text-lg font-bold">호출 예시</h2>
        <pre className="overflow-x-auto rounded bg-gray-900 p-3 text-xs text-gray-100">{`curl "https://<배포주소>/api/v1/risk?pest=${pests[0]?.pest_id ?? "apple_anthracnose"}&offset=3"

{
  "pest_id": "${pests[0]?.pest_id ?? "apple_anthracnose"}",
  "issued_date": "${status?.issued_date ?? "2026-07-15"}",
  "offset": 3,
  "spots": [
    { "spot_code": "...", "name": "...", "lat": 36.5, "lon": 127.5, "index": 62.0, "grade": "주의보" }
  ]
}`}</pre>
      </section>
      <section>
        <h2 className="text-lg font-bold">정적 파일</h2>
        <ul className="list-disc pl-5 text-sm">
          <li>
            <a className="underline" href="/data/summary.json">
              /data/summary.json
            </a>{" "}
            — 홈 요약
          </li>
          <li>
            <a className="underline" href="/data/spots.json">
              /data/spots.json
            </a>{" "}
            — 관측지점
          </li>
          <li>
            <a className="underline" href="/data/pests.json">
              /data/pests.json
            </a>{" "}
            — 모델 카드
          </li>
          <li>
            <code>/data/risk/&lt;pest_id&gt;.json</code>, <code>/data/spot/&lt;spot_code&gt;.json</code>
          </li>
          <li>일별 스냅샷 CSV: 저장소 <code>data/predictions/YYYY-MM-DD.csv</code></li>
        </ul>
      </section>
      <section className="text-sm text-gray-700">
        <h2 className="text-lg font-bold">이용 조건</h2>
        <p>출처(농촌진흥청 병해충 발생 예측 서비스)를 표시하면 상업적 이용·변경이 가능합니다. 대량 호출이 필요하면 API 키 발급(2단계)을 신청해 주세요.</p>
      </section>
    </div>
  );
}
