import Link from "next/link";
import type { Metadata } from "next";
import RiskBadge from "@/components/RiskBadge";
import { Icon, PageHeader } from "@/components/ui";
import { getPests, getStatus } from "@/lib/data";
import { CROP_LABEL, GRADES, TYPE_LABEL, pestFullName } from "@/lib/grades";
import { fmtDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "검증·소개" };

const MEANING: Record<string, string> = { 정상: "발생 조건 미충족", 예보: "발생 조건 형성 중", 주의보: "감염·발생 가능성 높음", 경보: "발생 조건 충족, 확산 우려" };

export default async function AboutPage() {
  const [status, pests] = await Promise.all([getStatus(), getPests()]);
  return (
    <div className="max-w-4xl space-y-8">
      <PageHeader
        eyebrow="서비스 소개"
        title="검증 · 소개"
        desc="농촌진흥청이 보유한 농업기상 관측자료(농업날씨365)와 기상청 예보를 입력으로, 작물별 병해충 발생 위험도를 매일 계산해 공개합니다. 모델의 입력 변수·임계값·근거 문헌(모델 카드)과 검증 지표를 함께 공개해 누구나 판단 근거를 확인할 수 있게 합니다."
      />

      <section className="card overflow-hidden">
        <h2 className="section-title px-5 pt-5 sm:px-6">등급 해석</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="table-clean">
            <thead>
              <tr>
                <th className="pl-5 sm:pl-6">등급</th>
                <th>위험지수</th>
                <th>의미</th>
                <th>권고 행동</th>
              </tr>
            </thead>
            <tbody>
              {GRADES.map((g) => (
                <tr key={g.name}>
                  <td className="pl-5 sm:pl-6">
                    <RiskBadge grade={g.name} size="sm" />
                  </td>
                  <td className="num text-slate-600">
                    {g.min} ~ {g.max}
                  </td>
                  <td className="text-slate-700">{MEANING[g.name]}</td>
                  <td className="text-slate-700">{g.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="section-title">작물 재배 여부 반영 (생물계절)</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
            작물이 자라지 않는 곳이나 시기에 위험도를 내면 잘못된 정보가 됩니다. 그래서 위험도를 발행하기 전에 두 가지를 확인하고, 해당하지 않으면 등급 대신 <RiskBadge grade={null} size="sm" /> 으로 표시합니다.
          </p>
        </div>
        <dl className="grid gap-4 sm:grid-cols-2">
          <div className="card card-pad">
            <dt className="flex items-center gap-2 font-semibold text-slate-900">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-50 text-brand-600">
                <Icon name="location" />
              </span>
              재배 지역
            </dt>
            <dd className="mt-3 text-sm leading-relaxed text-slate-600">관측지점이 있는 시군에 그 작물 재배면적이 기준 이하이면 &lsquo;비재배지&rsquo;로 봅니다. 근거: 시군별 노지 재배면적(농업경영체 등록정보)</dd>
          </div>
          <div className="card card-pad">
            <dt className="flex items-center gap-2 font-semibold text-slate-900">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-50 text-brand-600">
                <Icon name="leaf" />
              </span>
              재배 시기
            </dt>
            <dd className="mt-3 text-sm leading-relaxed text-slate-600">정식·이앙 전이나 수확 후처럼 작물이 포장에 없는 기간은 &lsquo;재배 시기 아님&rsquo;으로 봅니다. 근거: 권역·시도·시군별 재배 기간</dd>
          </div>
        </dl>
        {status?.phenology && (
          <p className="text-xs text-slate-500">
            현재 반영 자료 · 재배 지역: {status.phenology.cultivation_crops.length ? status.phenology.cultivation_crops.map((c) => CROP_LABEL[c] ?? c).join(", ") : "없음"} · 재배 시기:{" "}
            {status.phenology.calendar_crops.length ? status.phenology.calendar_crops.map((c) => CROP_LABEL[c] ?? c).join(", ") : "없음"}
            {status.phenology.cultivation_crops.length > 0 && ` · 기준: 시군 노지 재배면적 ${status.phenology.min_area_ha} ha 이하는 비재배지(농업경영체 등록정보)`}
          </p>
        )}
      </section>

      <section className="card overflow-hidden">
        <div className="flex items-baseline justify-between px-5 pt-5 sm:px-6">
          <h2 className="section-title">모델 검증 현황</h2>
          <span className="text-xs text-slate-400">예찰조사(2015~2025) 적재 후 연도별 지표 공개</span>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="table-clean">
            <thead>
              <tr>
                <th className="pl-5 sm:pl-6">병해충</th>
                <th>유형</th>
                <th>버전</th>
                <th>상태</th>
                <th>검증</th>
              </tr>
            </thead>
            <tbody>
              {pests.map((p) => (
                <tr key={p.pest_id}>
                  <td className="pl-5 sm:pl-6">
                    <Link href={`/pests/${p.pest_id}?tab=eval`} className="font-medium text-slate-900 hover:text-brand-700">
                      {pestFullName(p.crop_ko, p.name_ko)}
                    </Link>
                  </td>
                  <td className="text-slate-500">{TYPE_LABEL[p.type]}</td>
                  <td className="num text-slate-500">v{p.version}</td>
                  <td>
                    <span className="chip">{p.status === "draft" ? "초안" : p.status}</span>
                  </td>
                  <td>
                    {p.eval.status === "evaluated" ? (
                      <span className="chip bg-emerald-50 text-emerald-700">검증됨</span>
                    ) : (
                      <span className="chip bg-amber-50 text-amber-700">미검증</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-5 md:grid-cols-2">
        <section className="card card-pad">
          <h2 className="section-title">예측의 한계</h2>
          <ul className="mt-3 space-y-2 text-sm leading-relaxed text-slate-600">
            {[
              "관측지점 기준 예측이므로 지점에서 멀거나 지형이 다른 농장은 실제와 차이가 날 수 있습니다.",
              "3일 이후 전망은 기상청 중기예보 연동 전까지 최근 기상의 지속을 가정합니다.",
              "잎젖음시간은 습도·강우로 추정한 값입니다. 시간별 자료가 연결되면 실측으로 바뀝니다.",
              "비래 해충(벼멸구 등)은 비래 정보가 연동되기 전까지 보조 지표로만 보세요.",
              "초안(draft) 모델은 담당 연구자 검토 전의 초기 파라미터를 사용합니다.",
            ].map((t) => (
              <li key={t} className="flex gap-2">
                <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-400" />
                {t}
              </li>
            ))}
          </ul>
        </section>
        <section className="card card-pad">
          <h2 className="section-title">데이터 출처와 갱신</h2>
          <ul className="mt-3 space-y-2 text-sm leading-relaxed text-slate-600">
            {[
              "농업기상 관측: 농촌진흥청 국립농업과학원 농업날씨365 오픈API",
              "병해충 도감·발생정보: 국가농작물병해충관리시스템(NCPMS) 오픈API",
              "기상 예보: 기상청 단기예보(공공데이터포털)",
              "재배 현황: 농림축산식품부 농업경영체 등록정보",
              `갱신: 매일 새벽 1회 배치${status ? ` (마지막 ${fmtDateTime(status.generated_at)}, 모드 ${status.mode})` : ""}`,
            ].map((t) => (
              <li key={t} className="flex gap-2">
                <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-400" />
                {t}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="card card-pad flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="section-title">문의</h2>
          <p className="mt-1 text-sm text-slate-600">모델 개선 제안과 오류 신고는 GitHub 저장소의 Issue 로 남겨 주세요. 담당 부서 연락처는 운영 개시 후 안내합니다.</p>
        </div>
      </section>
    </div>
  );
}
