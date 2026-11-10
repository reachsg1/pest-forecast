import Link from "next/link";
import type { Metadata } from "next";
import RiskBadge from "@/components/RiskBadge";
import { getPests, getStatus } from "@/lib/data";
import { GRADES, TYPE_LABEL } from "@/lib/grades";

export const metadata: Metadata = { title: "검증·소개" };

export default async function AboutPage() {
  const [status, pests] = await Promise.all([getStatus(), getPests()]);
  return (
    <div className="max-w-3xl space-y-6">
      <section>
        <h1 className="text-xl font-bold">서비스 소개</h1>
        <p className="text-gray-700">
          농촌진흥청이 보유한 농업기상 관측자료(농업날씨365)와 기상청 예보를 입력으로, 작물별 병해충 발생 위험도를 매일 계산해 공개하는 서비스입니다. 예측 모델의 입력 변수·임계값·근거 문헌(모델 카드)과 검증
          지표를 함께 공개해 누구나 판단 근거를 확인할 수 있게 하는 것이 목적입니다. 예측 결과는 JSON API와 CSV로 재개방합니다.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold">등급 해석</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-gray-600">
              <th className="py-1">등급</th>
              <th className="py-1">위험지수</th>
              <th className="py-1">의미</th>
              <th className="py-1">권고 행동</th>
            </tr>
          </thead>
          <tbody>
            {GRADES.map((g) => (
              <tr key={g.name} className="border-b">
                <td className="py-1">
                  <RiskBadge grade={g.name} size="sm" />
                </td>
                <td className="py-1 tabular-nums">
                  {g.min}~{g.max}
                </td>
                <td className="py-1">{g.name === "정상" ? "발생 조건 미충족" : g.name === "예보" ? "발생 조건 형성 중" : g.name === "주의보" ? "감염·발생 가능성 높음" : "발생 조건 충족, 확산 우려"}</td>
                <td className="py-1">{g.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="text-lg font-bold">모델 검증 현황</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-gray-600">
              <th className="py-1">병해충</th>
              <th className="py-1">유형</th>
              <th className="py-1">버전</th>
              <th className="py-1">상태</th>
              <th className="py-1">검증</th>
            </tr>
          </thead>
          <tbody>
            {pests.map((p) => (
              <tr key={p.pest_id} className="border-b">
                <td className="py-1">
                  <Link href={`/pests/${p.pest_id}?tab=eval`} className="hover:underline">
                    {p.crop_ko} {p.name_ko}
                  </Link>
                </td>
                <td className="py-1">{TYPE_LABEL[p.type]}</td>
                <td className="py-1">v{p.version}</td>
                <td className="py-1">{p.status === "draft" ? "초안" : p.status}</td>
                <td className="py-1">{p.eval.status === "evaluated" ? "검증됨" : "미검증"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-gray-500">검증은 예찰조사(2015~2025) 적재 후 연도별 적중률·정밀도·재현율·리드타임으로 공개됩니다.</p>
      </section>

      <section>
        <h2 className="text-lg font-bold">예측의 한계</h2>
        <ul className="list-disc pl-5 text-sm text-gray-700">
          <li>관측지점 기준 예측이므로 지점에서 멀거나 지형이 다른 농장은 실제와 차이가 날 수 있습니다.</li>
          <li>3일 이후 전망은 기상청 중기예보 연동 전까지 최근 기상의 지속을 가정합니다.</li>
          <li>잎젖음시간은 습도·강우로 추정한 값입니다. 시간별 자료가 연결되면 실측으로 바뀝니다.</li>
          <li>비래 해충(벼멸구 등)은 비래 정보가 연동되기 전까지 보조 지표로만 보세요.</li>
          <li>초안(draft) 모델은 담당 연구자 검토 전의 초기 파라미터를 사용합니다.</li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-bold">데이터 출처와 갱신</h2>
        <ul className="list-disc pl-5 text-sm text-gray-700">
          <li>농업기상 관측: 농촌진흥청 국립농업과학원 농업날씨365 오픈API</li>
          <li>병해충 도감·발생정보: 국가농작물병해충관리시스템(NCPMS) 오픈API</li>
          <li>기상 예보: 기상청 단기예보(공공데이터포털)</li>
          <li>갱신: 매일 새벽 1회 배치 {status && `(마지막 ${status.generated_at.replace("T", " ")}, 모드 ${status.mode})`}</li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-bold">문의</h2>
        <p className="text-sm text-gray-700">모델 개선 제안과 오류 신고는 GitHub 저장소의 Issue 로 남겨 주세요. 담당 부서 연락처는 운영 개시 후 안내합니다.</p>
      </section>
    </div>
  );
}
