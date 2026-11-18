"use client";

import { useEffect, useMemo, useState } from "react";
import { GRADES } from "@/lib/grades";
import { MAP_H as H, MAP_W as W, featurePath, idxColor, mix, obsColor, p90, px, py } from "@/lib/mapColor";
import { fmtMD } from "@/lib/format";
import { assignSpots, sggValues, type SggGeo } from "@/lib/sgg";
import type { RiskFile } from "@/lib/types";

/**
 * 홈 히어로 지도(가벼운 SVG, 지도 라이브러리 없이).
 * - live  : 재배 시기 — 오늘부터 7일 뒤까지 시군 위험지수가 번져 가는 모습(지점 → 시군 최고값)
 * - season: 재배 시기가 아닐 때 — 지난 시즌 실제 NCPMS 예찰 조사값을 회차별로(조사한 시군만)
 * 움직임을 줄이도록 설정한 사용자에게는 마지막 장면만 보여 준다.
 */
export type HeroMapProps = { mode: "live"; pestId: string; caption: string } | { mode: "season"; pestId: string; year: number; caption: string; unit: string };

/** 지도 색 체계(홈 세이지 단색 + 주황 강조). 녹색 원색은 등급 '예보'·주 버튼과 겹치므로 쓰지 않는다.
 *  육지 바탕(조사 안 함·해당 없음) = 아주 옅은 세이지(EMPTY), 발생 없음 = 회세이지(ZERO), 발생 = 노랑→주황→빨강(등급색 계열).
 *  시군 경계 = 흰 선(옅은 면 위에서 또렷), 해안선 = 짙은 세이지 굵은 선(시군 아래에 한 번 더 그려 바깥 테두리만 남김) */
const EMPTY = "#eef3ee";
const ZERO = "#c9d5cc";
const COAST = "#8d9e91";
const BORDER = "#ffffff";

type Frame = { label: string; values: Map<string, number | null>; sub?: string };

export default function HeroMap(props: HeroMapProps) {
  const [geo, setGeo] = useState<SggGeo | null>(null);
  const [frames, setFrames] = useState<Frame[] | null>(null);
  const [vmax, setVmax] = useState(1);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    fetch("/geo/sigungu.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((g) => g && setGeo(g))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!geo) return;
    let alive = true;
    if (props.mode === "live") {
      fetch(`/data/risk/${props.pestId}.json`)
        .then((r) => (r.ok ? r.json() : null))
        .then((r: RiskFile | null) => {
          if (!alive || !r) return;
          const assign = assignSpots(geo, r.spots);
          const fs: Frame[] = [];
          for (let k = 0; k <= Math.min(7, r.horizon_days); k++) {
            const byCode = new Map(r.spots.map((s) => [s.spot_code, { name: s.name, index: s.index_by_offset?.[k] ?? null }]));
            const vals = sggValues(geo, assign, byCode);
            const d = new Date(`${r.issued_date}T00:00:00`);
            d.setDate(d.getDate() + k);
            fs.push({ label: k === 0 ? "오늘" : `${k}일 뒤`, sub: `${d.getMonth() + 1}.${d.getDate()}.`, values: new Map(vals.map((v) => [v.key, v.idx])) });
          }
          setFrames(fs);
        })
        .catch(() => {});
    } else {
      const year = props.year;
      fetch(`/data/surveyview/${props.pestId}.json`)
        .then((r) => (r.ok ? r.json() : null))
        .then((v: { rounds: { date: string; rows: [string, number][] }[] } | null) => {
          if (!alive || !v) return;
          const rounds = v.rounds.filter((r) => r.date.startsWith(String(year)));
          setVmax(p90(rounds.flatMap((r) => r.rows.map(([, x]) => x))));
          setFrames(rounds.map((r) => ({ label: fmtMD(r.date), values: new Map(r.rows.map(([k, x]) => [k, x])) })));
        })
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo, props.mode, props.pestId]);

  // 움직임 줄이기 설정이면 마지막 장면에서 멈춤
  useEffect(() => {
    if (!frames?.length) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setPlaying(false);
      setI(frames.length - 1);
    }
  }, [frames]);

  useEffect(() => {
    if (!playing || !frames || frames.length < 2) return;
    const last = i === frames.length - 1;
    const t = setTimeout(() => setI((x) => (x + 1) % frames.length), last ? 4500 : 1800); // 장면당 1.8초, 마지막 장면은 4.5초 머문 뒤 처음부터
    return () => clearTimeout(t);
  }, [playing, frames, i]);

  const paths = useMemo(
    () =>
      geo?.features.map((f) => ({
        key: f.properties.key,
        name: f.properties.name,
        lat: f.properties.lat,
        lon: f.properties.lon,
        d: featurePath(f.geometry),
      })) ?? [],
    [geo],
  );

  const frame = frames?.[Math.min(i, (frames?.length ?? 1) - 1)];
  const color = (k: string) => {
    const v = frame?.values.get(k);
    // 재배 시기 '정상'(0~24)은 위성지도용 짙은 회색 대신 밝은 회색으로 — 흰 카드 위에서 위험한 곳만 눈에 띄게
    if (props.mode === "live") return v != null && v < 25 ? mix("#e2e7ee", GRADES[0].color, v / 24) : idxColor(v, EMPTY);
    return obsColor(v, vmax, EMPTY, ZERO);
  };

  // 이 장면에서 가장 높은 시군 3곳 이름표
  const tags = useMemo(() => {
    if (!frame) return [];
    const min = props.mode === "live" ? 50 : 0.0001;
    return paths
      .map((p) => ({ ...p, v: frame.values.get(p.key) ?? null }))
      .filter((p) => p.v != null && p.v >= min)
      .sort((a, b) => (b.v as number) - (a.v as number))
      .slice(0, 3);
  }, [frame, paths, props.mode]);

  const nObs = frame ? Array.from(frame.values.values()).filter((v) => v != null).length : 0;
  const nPos = frame ? Array.from(frame.values.values()).filter((v) => v != null && v > (props.mode === "live" ? 49.999 : 0)).length : 0;

  return (
    <figure className="relative mx-auto w-full max-w-[460px] lg:max-w-[min(560px,calc((100vh-250px)*0.86))]" aria-label={props.caption}>
      <div className="relative pt-14">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full drop-shadow-[0_2px_4px_rgba(31,61,42,0.10)]" role="img" aria-hidden="true">
          {/* 해안선: 굵은 선을 먼저 그리고 그 위를 시군 면이 덮어 바깥 테두리만 남긴다 */}
          <g fill="none" stroke={COAST} strokeWidth={1.5} strokeLinejoin="round">
            {paths.map((p) => (
              <path key={p.key} d={p.d} />
            ))}
          </g>
          {paths.map((p) => (
            <path key={p.key} d={p.d} fill={color(p.key)} stroke={BORDER} strokeWidth={0.5} strokeLinejoin="round" style={{ transition: "fill 1100ms ease" }} />
          ))}
          {tags.map((t, k) => (
            <g key={t.key}>
              <circle cx={px(t.lon)} cy={py(t.lat)} r={11} fill="#0f172a" stroke="#fff" strokeWidth={1.5} />
              <text x={px(t.lon)} y={py(t.lat) + 4} textAnchor="middle" fontSize={12} fontWeight={700} fill="#fff">
                {k + 1}
              </text>
            </g>
          ))}
        </svg>
        {/* 가장 높은 시군 순위(지도 번호와 같음) */}
        {tags.length > 0 && (
          <ol className="absolute bottom-2 right-0 space-y-1 rounded-xl border border-[#e3e9e4] bg-white/95 px-3 py-2 text-[11px] text-slate-700 shadow-sm backdrop-blur">
            {tags.map((t, k) => (
              <li key={t.key} className="flex items-center gap-2">
                <span className="num grid h-4 w-4 place-items-center rounded-full bg-slate-900 text-[10px] font-bold text-white">{k + 1}</span>
                <span className="font-semibold text-slate-900">{t.key.split(" ").slice(1).join(" ")}</span>
                <span className="num ml-auto pl-2 text-slate-500">{props.mode === "live" ? Math.round(t.v as number) : `${t.v}%`}</span>
              </li>
            ))}
          </ol>
        )}
        {/* 장면 표시 */}
        <div className="absolute left-0 top-0 text-left">
          <div className="num text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{frame?.label ?? "…"}</div>
          {frame?.sub && <div className="num text-xs text-slate-500">{frame.sub}</div>}
          {frame && (
            <div className="num mt-1 text-xs text-slate-600">
              {props.mode === "live" ? `주의보 이상 ${nPos}개 시군` : `조사 ${nObs}개 시군 중 발생 ${nPos}곳`}
            </div>
          )}
        </div>
      </div>

      {/* 진행 막대 + 재생 */}
      {frames && frames.length > 1 && (
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => setPlaying((v) => !v)}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-[#dfe7e1] bg-white text-[#3f5446] shadow-sm hover:bg-[#f3f7f3]"
            aria-label={playing ? "일시 정지" : "재생"}
          >
            {playing ? (
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
                <rect x="6" y="5" width="4" height="14" rx="1" />
                <rect x="14" y="5" width="4" height="14" rx="1" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
                <path d="M7 5v14l12-7z" />
              </svg>
            )}
          </button>
          <div className="flex flex-1 gap-1">
            {frames.map((f, k) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setPlaying(false);
                  setI(k);
                }}
                className={`h-1.5 flex-1 rounded-full transition ${k <= i ? "bg-[#5d7263]" : "bg-[#e3eae4]"}`}
                aria-label={`${f.label} 보기`}
              />
            ))}
          </div>
        </div>
      )}

      {/* 범례 */}
      <figcaption className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
        {props.mode === "live" ? (
          <>
            {GRADES.map((g) => (
              <span key={g.name} className="inline-flex items-center gap-1">
                <i className="h-2 w-2 rounded-sm" style={{ background: g.color }} /> {g.name}
              </span>
            ))}
            <span className="inline-flex items-center gap-1">
              <i className="h-2 w-2 rounded-sm border border-slate-300" style={{ background: EMPTY }} /> 해당 없음
            </span>
          </>
        ) : (
          <>
            <span className="inline-flex items-center gap-1">
              <i className="h-2 w-2 rounded-sm" style={{ background: ZERO }} /> 발생 없음
            </span>
            <span className="inline-flex items-center gap-1">
              <i className="h-2 w-8 rounded-sm" style={{ background: `linear-gradient(to right, #f3cf7a, ${GRADES[2].color}, ${GRADES[3].color})` }} /> 발생(낮음→높음, {props.unit})
            </span>
            <span className="inline-flex items-center gap-1">
              <i className="h-2 w-2 rounded-sm border border-slate-300" style={{ background: EMPTY }} /> 조사 안 함
            </span>
          </>
        )}
        <span className="w-full text-slate-400">{props.caption}</span>
      </figcaption>
    </figure>
  );
}
