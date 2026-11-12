"use client";

import { useEffect, useMemo, useState } from "react";
import RiskBadge from "./RiskBadge";
import { gradeMeta } from "@/lib/grades";
import type { Grade } from "@/lib/types";

type Ncpms = { name: string; ncpms_key: string; environment: string; symptoms: string; prevention: string; chemical: string; biological: string };
type Pesticide = { product: string; brand: string; company: string; moa: string; use: string; crop: string; target: string; status: string };
export type ControlDoc = { pest_id: string; ncpms: Ncpms[]; pesticides: Pesticide[]; sources: { ncpms: string; pesticides: string }; note: string };

const cache = new Map<string, Promise<ControlDoc | null>>();
export function loadControl(pestId: string): Promise<ControlDoc | null> {
  if (!cache.has(pestId)) cache.set(pestId, fetch(`/data/control/${pestId}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  return cache.get(pestId)!;
}

/** 등급별 지금 할 일(등급 정의의 행동 기준을 풀어 쓴 것) */
const TODO: Record<Grade, string[]> = {
  정상: ["평소처럼 포장을 살펴보세요."],
  예보: ["포장을 자주 살펴 첫 발생(증상·유충·성충)을 확인하세요.", "등록 약제와 방제 장비를 미리 준비하세요.", "병든 잎·과실 등 전염원을 치워 두세요."],
  주의보: ["발생 초기라면 등록 약제로 예방 살포를 검토하세요.", "비 오기 전후, 바람이 약한 때 살포하고 작용기작이 다른 약제를 번갈아 쓰세요.", "주변 농가·지역 농업기술센터 예찰 소식도 확인하세요."],
  경보: ["등록 약제로 적기 방제하세요(살포 간격·횟수는 제품 라벨 기준).", "작용기작이 다른 약제를 번갈아 써 저항성을 막으세요.", "피해 부위를 제거해 포장 밖에서 처리하세요."],
};

function moaGroups(list: Pesticide[]) {
  const by = new Map<string, Pesticide[]>();
  for (const p of list) by.set(p.moa || "기타", [...(by.get(p.moa || "기타") ?? []), p]);
  return Array.from(by.entries()).sort((a, b) => b[1].length - a[1].length);
}

/** 할 일 요약 상자(지점 패널·내 농장): 등급이 예보 이상일 때만 쓴다 */
export function ActionBox({ pestId, grade, pestName }: { pestId: string; grade: Grade; pestName: string }) {
  const [doc, setDoc] = useState<ControlDoc | null>(null);
  useEffect(() => {
    loadControl(pestId).then(setDoc);
  }, [pestId]);
  const groups = useMemo(() => (doc ? moaGroups(doc.pesticides.filter((p) => p.status === "확정")) : []), [doc]);
  const m = gradeMeta(grade);
  return (
    <div className={`rounded-xl p-3 ring-1 ring-inset ${m.bg} ${m.ring}`}>
      <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
        <RiskBadge grade={grade} size="sm" /> {pestName} · 지금 할 일
      </div>
      <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-relaxed text-slate-700">
        {TODO[grade].map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      {groups.length > 0 && (
        <p className="mt-2 text-[11px] leading-relaxed text-slate-600">
          등록 약제 예(작용기작이 다른 것끼리):{" "}
          {groups
            .slice(0, 3)
            .map(([moa, ps]) => `${ps[0].product}(${moa})`)
            .join(" · ")}{" "}
          외 {doc!.pesticides.length}종
        </p>
      )}
      <a href={`/pests/${pestId}?tab=control`} className="mt-1.5 inline-block text-[11px] font-semibold text-brand-700 hover:underline">
        방제 정보·등록 약제 전체 보기 →
      </a>
    </div>
  );
}

/** 병해충 상세 '방제 정보' 탭 */
export default function ControlGuide({ pestId, pestName, grade }: { pestId: string; pestName: string; grade: Grade | null }) {
  const [doc, setDoc] = useState<ControlDoc | null | undefined>(undefined);
  const [q, setQ] = useState("");
  const [onlyFixed, setOnlyFixed] = useState(true);
  useEffect(() => {
    loadControl(pestId).then(setDoc);
  }, [pestId]);

  const list = useMemo(() => {
    if (!doc) return [];
    const s = q.trim();
    return doc.pesticides.filter((p) => (!onlyFixed || p.status === "확정") && (!s || `${p.product} ${p.brand} ${p.company} ${p.moa}`.includes(s)));
  }, [doc, q, onlyFixed]);
  const groups = useMemo(() => moaGroups(list), [list]);

  if (doc === undefined) return <p className="py-6 text-center text-xs text-slate-400">방제 정보를 불러오는 중…</p>;
  if (doc === null) return <p className="text-sm text-slate-500">이 병해충의 방제 정보가 아직 없어요.</p>;

  const g: Grade = grade ?? "정상";
  return (
    <div className="space-y-5">
      {/* 지금 할 일 */}
      <div className={`rounded-xl p-4 ring-1 ring-inset ${gradeMeta(g).bg} ${gradeMeta(g).ring}`}>
        <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-800">
          오늘 전국 최고 <RiskBadge grade={grade} size="sm" /> 기준 지금 할 일
        </div>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-slate-700">
          {TODO[g].map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-slate-500">내 지역 등급은 예측 지도에서 지점을 눌러 확인하세요. 예보 단계부터 아래 요령과 등록 약제를 준비하는 것이 좋아요.</p>
      </div>

      {/* NCPMS 요령 */}
      {doc.ncpms.map((n) => (
        <section key={n.ncpms_key} className="space-y-3">
          <h3 className="section-title">
            {n.name} 방제 요령 <span className="text-xs font-normal text-slate-400">NCPMS</span>
          </h3>
          <dl className="grid gap-3 md:grid-cols-2">
            {[
              ["예방·재배적 방제", n.prevention],
              ["약제 방제", n.chemical],
              ["생물적 방제", n.biological],
              ["발생 환경·생태", n.environment],
              ["증상·피해", n.symptoms],
            ]
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <details key={k} className="group rounded-xl border border-slate-100 p-4" open={k === "예방·재배적 방제" || k === "약제 방제"}>
                  <summary className="cursor-pointer list-none text-xs font-semibold text-slate-500">
                    {k} <span className="text-slate-300 group-open:hidden">▾</span>
                  </summary>
                  <dd className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-slate-700">{v}</dd>
                </details>
              ))}
          </dl>
        </section>
      ))}

      {/* 등록 약제 */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h3 className="section-title">
            {pestName} 등록 약제 <span className="num text-xs font-normal text-slate-400">{list.length}종</span>
          </h3>
          <div className="flex items-center gap-2">
            <input className="field py-1.5 text-xs" value={q} onChange={(e) => setQ(e.target.value)} placeholder="품목·상표·회사 검색" aria-label="등록 약제 검색" />
            <label className="flex items-center gap-1 whitespace-nowrap text-xs text-slate-500">
              <input type="checkbox" checked={onlyFixed} onChange={(e) => setOnlyFixed(e.target.checked)} /> 안전사용기준 확정만
            </label>
          </div>
        </div>
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
          같은 작용기작(번호) 약제를 연달아 쓰면 저항성이 생기기 쉬워요. 작용기작이 다른 약제를 번갈아 쓰세요. {doc.note}
        </p>
        <div className="space-y-3">
          {groups.map(([moa, ps]) => (
            <details key={moa} className="rounded-xl border border-slate-100" open={groups.length <= 3}>
              <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5 text-sm">
                <span>
                  작용기작 <b className="font-semibold text-slate-800">{moa}</b>
                </span>
                <span className="num text-xs text-slate-400">{ps.length}종</span>
              </summary>
              <div className="-mx-px overflow-x-auto border-t border-slate-100">
                <table className="table-clean">
                  <thead>
                    <tr>
                      <th>품목(성분·제형)</th>
                      <th>상표</th>
                      <th className="hidden sm:table-cell">회사</th>
                      <th>기준</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ps.map((p) => (
                      <tr key={`${p.product}-${p.brand}-${p.company}`}>
                        <td className="font-medium text-slate-800">{p.product}</td>
                        <td>{p.brand}</td>
                        <td className="hidden text-slate-500 sm:table-cell">{p.company}</td>
                        <td className={p.status === "확정" ? "text-slate-500" : "text-amber-700"}>{p.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
        </div>
        <p className="text-[11px] leading-relaxed text-slate-400">
          출처: {doc.sources.ncpms} · {doc.sources.pesticides} 희석배수·사용 시기·수확 전 사용일수는 농약안전정보시스템(psis.rda.go.kr)과 제품 라벨을 확인하세요.
        </p>
      </section>
    </div>
  );
}
