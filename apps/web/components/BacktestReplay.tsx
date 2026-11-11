"use client";

import { useEffect, useMemo, useState } from "react";
import RiskBadge from "./RiskBadge";
import { Icon } from "./ui";
import { gradeOf } from "@/lib/grades";
import { fmtMD } from "@/lib/format";

type BtRow = { sigungu: string; loc: [number, number] | null; actual: number; prev: number; wx_km: number; pred: Record<string, number> };
type BtRound = { date: string; year: number; split: "train" | "test"; rows: BtRow[] };
type BtFile = {
  pest_id: string;
  target: string;
  threshold_index: number;
  train_years: number[];
  test_years: number[];
  models: { key: string; model_id: string; label: string; is_default: boolean }[];
  rounds: BtRound[];
};

type Verdict = "hit" | "correct_neg" | "miss" | "false_alarm";
const VERDICT: Record<Verdict, { label: string; cls: string }> = {
  hit: { label: "맞힘(발생)", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  correct_neg: { label: "맞힘(미발생)", cls: "bg-slate-50 text-slate-600 ring-slate-200" },
  miss: { label: "놓침", cls: "bg-rose-50 text-rose-700 ring-rose-200" },
  false_alarm: { label: "헛경보", cls: "bg-amber-50 text-amber-700 ring-amber-200" },
};

function verdictOf(pred: number, actual: number, thr: number): Verdict {
  const p = Math.floor(pred) >= thr; // 내림 정수 = 화면 표시값. floor(x)≥50 ⇔ x≥50 이라 검증 기준(확률 0.5)과 같다
  const a = actual > 0;
  return p && a ? "hit" : !p && !a ? "correct_neg" : a ? "miss" : "false_alarm";
}

function stats(rows: BtRow[], key: string, thr: number) {
  const c = { hit: 0, correct_neg: 0, miss: 0, false_alarm: 0 } as Record<Verdict, number>;
  rows.forEach((r) => c[verdictOf(r.pred[key] ?? 0, r.actual, thr)]++);
  const n = rows.length;
  return { ...c, n, acc: n ? (c.hit + c.correct_neg) / n : 0, occurred: rows.filter((r) => r.actual > 0).length };
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** 과거 예찰 회차로 되돌려, 그날 모델 위험지수와 실제 예찰값을 시군별로 비교한다. */
export default function BacktestReplay({ pestId }: { pestId: string }) {
  const [file, setFile] = useState<BtFile | null | undefined>(undefined);
  const [modelKey, setModelKey] = useState("");
  const [year, setYear] = useState<number | null>(null);
  const [date, setDate] = useState("");
  const [onlyWrong, setOnlyWrong] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/data/backtest/${pestId}.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: BtFile | null) => {
        if (!alive) return;
        setFile(d);
        if (d) {
          setModelKey((d.models.find((m) => m.is_default) ?? d.models[0]).key);
          const last = d.rounds[d.rounds.length - 1];
          setYear(last?.year ?? null);
          setDate(last?.date ?? "");
        }
      })
      .catch(() => alive && setFile(null));
    return () => {
      alive = false;
    };
  }, [pestId]);

  const years = useMemo(() => (file ? Array.from(new Set(file.rounds.map((r) => r.year))).sort((a, b) => b - a) : []), [file]);
  const yearRounds = useMemo(() => (file ? file.rounds.filter((r) => r.year === year) : []), [file, year]);
  const round = yearRounds.find((r) => r.date === date) ?? yearRounds[yearRounds.length - 1];

  if (file === undefined) return <p className="py-6 text-center text-xs text-slate-400">과거 예찰 자료를 불러오는 중…</p>;
  if (file === null || !round)
    return (
      <div className="flex gap-3 rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-5">
        <Icon name="chart" className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" />
        <div>
          <p className="font-medium text-slate-700">이 병해충은 아직 과거 예찰과 비교할 자료가 없어요.</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">NCPMS 시군 예찰로 학습·검증한 모델이 있는 병해충만 되돌려 볼 수 있습니다(현재 고추 탄저병).</p>
        </div>
      </div>
    );

  const thr = file.threshold_index;
  const model = file.models.find((m) => m.key === modelKey) ?? file.models[0];
  const s = stats(round.rows, model.key, thr);
  const ys = stats(yearRounds.flatMap((r) => r.rows), model.key, thr);
  const isTrain = round.split === "train";
  const rows = onlyWrong ? round.rows.filter((r) => ["miss", "false_alarm"].includes(verdictOf(r.pred[model.key] ?? 0, r.actual, thr))) : round.rows;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="section-title">과거 날짜로 되돌려 보기</h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          지난 예찰 조사일에 모델이 냈을 위험지수를 그날 실제 조사한 피해과율과 시군별로 비교합니다. 위험지수 {thr} 이상(주의보)을 &lsquo;발생 예상&rsquo;, 피해과율 0% 초과를 &lsquo;실제 발생&rsquo;으로 봅니다.
        </p>
      </div>

      {/* 조건 */}
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <label className="block">
          <span className="text-xs font-medium text-slate-500">모델</span>
          <select className="field mt-1 w-full" value={model.key} onChange={(e) => setModelKey(e.target.value)}>
            {file.models.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
                {m.is_default ? " (기본)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-500">연도</span>
          <select
            className="field mt-1 w-full"
            value={year ?? ""}
            onChange={(e) => {
              const y = Number(e.target.value);
              setYear(y);
              const rs = file.rounds.filter((r) => r.year === y);
              setDate(rs[rs.length - 1]?.date ?? "");
            }}
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}년{file.train_years.includes(y) ? " · 학습에 쓴 해" : " · 검증용"}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-500">예찰 조사일</span>
          <select className="field mt-1 w-full" value={round.date} onChange={(e) => setDate(e.target.value)}>
            {yearRounds.map((r) => (
              <option key={r.date} value={r.date}>
                {fmtMD(r.date)} ({r.rows.length}개 시군)
              </option>
            ))}
          </select>
        </label>
      </div>

      {isTrain && (
        <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
          <Icon name="info" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {round.year}년은 모델 학습에 쓴 해라 실제 성능보다 좋게 나옵니다. 정직한 비교는 검증용 연도({file.test_years.join("·")})를 보세요.
        </p>
      )}

      {/* 요약 */}
      <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
        <p className="text-sm text-slate-700">
          <b className="num">{fmtMD(round.date)}</b> 조사 {s.n}개 시군 중 실제 발생 <b className="num">{s.occurred}곳</b>. {model.label}은{" "}
          <b className="num text-slate-900">{s.hit + s.correct_neg}곳({pct(s.acc)})</b>을 맞혔어요.
        </p>
        <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(["hit", "correct_neg", "miss", "false_alarm"] as Verdict[]).map((v) => (
            <li key={v} className="rounded-lg bg-white px-3 py-2 ring-1 ring-inset ring-slate-100">
              <div className="text-[11px] text-slate-500">{VERDICT[v].label}</div>
              <div className="num text-lg font-bold text-slate-900">{s[v]}</div>
            </li>
          ))}
        </ul>
        <p className="num mt-3 text-xs text-slate-400">
          {round.year}년 전체 {yearRounds.length}회차 {ys.n}건: 정확도 {pct(ys.acc)} · 놓침 {ys.miss} · 헛경보 {ys.false_alarm}
        </p>
      </div>

      {/* 시군별 */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-slate-500">시군별 예측과 실제 · 실제 피해과율 높은 순</span>
        <label className="flex items-center gap-1.5 text-xs text-slate-500">
          <input type="checkbox" checked={onlyWrong} onChange={(e) => setOnlyWrong(e.target.checked)} /> 틀린 곳만
        </label>
      </div>
      <div className="-mx-3 overflow-x-auto">
        <table className="table-clean">
          <thead>
            <tr>
              <th>시군</th>
              <th>예측(그날)</th>
              <th className="text-right">실제 피해과율</th>
              <th className="hidden text-right sm:table-cell">직전 예찰</th>
              <th>판정</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const p = Math.floor(r.pred[model.key] ?? 0);
              const v = verdictOf(p, r.actual, thr);
              return (
                <tr key={r.sigungu}>
                  <td className="whitespace-nowrap font-medium">
                    {r.sigungu}
                    {r.wx_km > 0 && <span className="ml-1 text-[10px] font-normal text-slate-400" title="이 시군에 관측소가 없어 가까운 시군 기상을 씀">기상 {r.wx_km}km 대체</span>}
                  </td>
                  <td className="whitespace-nowrap">
                    <RiskBadge grade={gradeOf(p)} index={p} size="sm" />
                  </td>
                  <td className={`num text-right ${r.actual > 0 ? "font-semibold text-slate-900" : "text-slate-400"}`}>{r.actual}%</td>
                  <td className="num hidden text-right text-slate-400 sm:table-cell">{r.prev}%</td>
                  <td>
                    <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${VERDICT[v].cls}`}>{VERDICT[v].label}</span>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-xs text-slate-400">
                  틀린 곳이 없어요.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs leading-relaxed text-slate-400">
        예측은 조사일 전날까지의 실제 관측 기상과 같은 해 직전 회차 예찰값으로 계산했습니다(지금 배포된 모델 파일 그대로). 예보 오차는 포함하지 않아 실제 운영보다 약간 유리합니다.
      </p>
    </div>
  );
}
