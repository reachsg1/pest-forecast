"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import AddressSearch from "./AddressSearch";
import FarmSite from "./FarmSite";
import { ActionBox } from "./ControlGuide";
import RiskBadge from "./RiskBadge";
import { Icon } from "./ui";
import { NA, NA_REASONS, fmtIndex, gradeMeta } from "@/lib/grades";
import type { SpotFile, Spot } from "@/lib/types";

type PestLite = { pest_id: string; name_ko: string; crop: string; crop_ko: string };
type Farm = { id: string; name: string; crop: string; lat: number; lon: number; spot_code: string; distance_km: number };

const KEY = "pest-forecast.farms.v1";

function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(toRad(lat2 - lat1) / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lon2 - lon1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function nearest(spots: Spot[], lat: number, lon: number) {
  let best: { s: Spot; d: number } | null = null;
  for (const s of spots) {
    if (s.lat == null || s.lon == null) continue;
    const d = haversine(lat, lon, s.lat, s.lon);
    if (!best || d < best.d) best = { s, d };
  }
  return best;
}

function loadFarms(): Farm[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

export default function FarmClient({ spots, pests, horizon }: { spots: Spot[]; pests: PestLite[]; horizon: number }) {
  const sp = useSearchParams();
  const crops = useMemo(() => Array.from(new Set(pests.map((p) => p.crop))), [pests]);
  const [farms, setFarms] = useState<Farm[]>([]);
  const [name, setName] = useState("");
  const [crop, setCrop] = useState(crops[0] ?? "");
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [msg, setMsg] = useState("");
  const [files, setFiles] = useState<Record<string, SpotFile>>({});

  useEffect(() => {
    setFarms(loadFarms());
    const preset = sp.get("spot");
    if (preset) {
      const s = spots.find((x) => x.spot_code === preset);
      if (s && s.lat != null && s.lon != null) {
        setLat(String(s.lat));
        setLon(String(s.lon));
        setName(`${s.name} 인근 농장`);
      }
    }
  }, [sp, spots]);

  useEffect(() => {
    const codes = Array.from(new Set(farms.map((f) => f.spot_code))).filter((c) => !files[c]);
    codes.forEach((c) =>
      fetch(`/data/spot/${c}.json`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => j && setFiles((prev) => ({ ...prev, [c]: j }))),
    );
  }, [farms, files]);

  const save = (list: Farm[]) => {
    setFarms(list);
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
    } catch {
      /* 저장 공간 없음 등은 무시 */
    }
  };

  const add = () => {
    const la = Number(lat), lo = Number(lon);
    // 빈 칸은 Number("")=0 이 되므로 따로 막고, 우리나라 범위만 받는다
    if (!name.trim() || !crop || !lat.trim() || !lon.trim() || !Number.isFinite(la) || !Number.isFinite(lo)) {
      setMsg("농장 이름, 작물, 위치(주소 검색 또는 위도·경도)를 입력하세요.");
      return;
    }
    if (!(la > 32 && la < 39.5 && lo > 124 && lo < 132)) {
      setMsg("우리나라 안의 위치를 입력하세요(위도 33~39, 경도 124~132).");
      return;
    }
    const n = nearest(spots, la, lo);
    if (!n) {
      setMsg("관측지점 정보가 없습니다.");
      return;
    }
    save([...farms, { id: String(Date.now()), name: name.trim(), crop, lat: la, lon: lo, spot_code: n.s.spot_code, distance_km: Math.round(n.d * 10) / 10 }]);
    setName("");
    setMsg("");
  };

  const locate = () => {
    if (!navigator.geolocation) return setMsg("이 브라우저는 위치 정보를 지원하지 않습니다.");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLat(p.coords.latitude.toFixed(5));
        setLon(p.coords.longitude.toFixed(5));
        setMsg("");
      },
      () => setMsg("위치를 가져오지 못했습니다. 위도·경도를 직접 입력하세요."),
    );
  };

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[360px_1fr]">
      <form
        className="card card-pad space-y-4 text-sm lg:sticky lg:top-24"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-50 text-brand-600">
            <Icon name="plus" />
          </span>
          <h2 className="section-title">농장 추가</h2>
        </div>
        <label className="block">
          <span className="field-label">농장 이름</span>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 뒷밭 사과원" />
        </label>
        <label className="block">
          <span className="field-label">작물</span>
          <select className="field" value={crop} onChange={(e) => setCrop(e.target.value)}>
            {crops.map((c) => (
              <option key={c} value={c}>
                {pests.find((p) => p.crop === c)?.crop_ko ?? c}
              </option>
            ))}
          </select>
        </label>
        <div className="block">
          <span className="field-label">위치 찾기</span>
          <AddressSearch
            onPick={(h) => {
              setLat(h.lat.toFixed(5));
              setLon(h.lon.toFixed(5));
              setMsg("");
            }}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="field-label">위도</span>
            <input className="field num" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="36.5" />
          </label>
          <label className="block">
            <span className="field-label">경도</span>
            <input className="field num" inputMode="decimal" value={lon} onChange={(e) => setLon(e.target.value)} placeholder="127.5" />
          </label>
        </div>
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={locate} className="btn-secondary flex-1">
            <Icon name="location" /> 현재 위치
          </button>
          <button type="submit" className="btn-primary flex-1">
            추가
          </button>
        </div>
        {msg && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{msg}</p>}
        <p className="text-xs leading-relaxed text-slate-400">주소·지명을 검색하거나 현재 위치를 쓰면 위도·경도가 채워져요. 농장 정보는 이 브라우저에만 저장돼요.</p>
      </form>

      <section className="space-y-4" aria-label="등록한 농장">
        {farms.length === 0 && (
          <div className="card flex flex-col items-center px-6 py-16 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-400">
              <Icon name="farm" className="h-6 w-6" />
            </span>
            <p className="mt-4 font-semibold text-slate-700">등록된 농장이 없습니다</p>
            <p className="mt-1 text-sm text-slate-500">왼쪽에서 농장 위치와 작물을 추가하면 가장 가까운 관측지점의 위험도를 보여 드립니다.</p>
          </div>
        )}
        {farms.map((f) => {
          const file = files[f.spot_code];
          const myPests = pests.filter((p) => p.crop === f.crop);
          return (
            <article key={f.id} className="card overflow-hidden">
              <div className="flex items-start justify-between gap-3 px-5 pt-5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-lg font-bold tracking-tight">{f.name}</h3>
                    <span className="chip bg-brand-50 text-brand-700">{pests.find((p) => p.crop === f.crop)?.crop_ko}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    최근접 관측지점 {file?.spot.name ?? f.spot_code} · <span className="num">{f.distance_km} km</span>
                  </p>
                </div>
                <button onClick={() => save(farms.filter((x) => x.id !== f.id))} className="btn-secondary btn-sm text-slate-500">
                  삭제
                </button>
              </div>
              {!file ? (
                <div className="m-5 h-24 animate-pulse rounded-xl bg-slate-100" />
              ) : (
                <div className="mt-3 overflow-x-auto px-2 pb-2">
                  <table className="table-clean">
                    <thead>
                      <tr>
                        <th>병해충</th>
                        <th>오늘</th>
                        <th className="w-1/2">{horizon}일 타임라인</th>
                      </tr>
                    </thead>
                    <tbody>
                      {myPests.map((p) => {
                        const s = (file.series[p.pest_id] ?? []).filter((x) => x.offset >= 0 && x.offset <= horizon);
                        const today = s.find((x) => x.offset === 0);
                        return (
                          <tr key={p.pest_id}>
                            <td>
                              <Link href={`/pests/${p.pest_id}?spot=${f.spot_code}&tab=trend`} className="font-medium text-slate-900 hover:text-brand-700">
                                {p.name_ko}
                              </Link>
                            </td>
                            <td>{today ? <RiskBadge grade={today.grade} index={today.index} na={today.na_reason} size="sm" /> : "-"}</td>
                            <td>
                              <div className="flex gap-1" role="img" aria-label={s.map((x) => `${x.offset}일 ${x.grade ?? NA.label}`).join(", ")}>
                                {s.map((x) =>
                                  x.grade == null ? (
                                    // 해당 없음: 빈 칸(점선 테두리)으로 등급색과 구분
                                    <span key={x.offset} title={`+${x.offset}일 ${NA.label}${x.na_reason ? " · " + NA_REASONS[x.na_reason].short : ""}`} className="h-5 flex-1 rounded-md border border-dashed border-slate-300 bg-white" />
                                  ) : (
                                    <span key={x.offset} title={`+${x.offset}일 ${x.grade} ${fmtIndex(x.index)}`} className="h-5 flex-1 rounded-md" style={{ background: gradeMeta(x.grade).color, opacity: x.offset === 0 ? 1 : 0.7 }} />
                                  ),
                                )}
                              </div>
                              <div className="mt-1 flex justify-between text-[10px] text-slate-400">
                                <span>오늘</span>
                                <span>+{horizon}일</span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {file && (
                <div className="space-y-2 px-5 pb-4">
                  {myPests.map((p) => {
                    const t = (file.series[p.pest_id] ?? []).find((x) => x.offset === 0);
                    return t?.grade && t.grade !== "정상" ? <ActionBox key={p.pest_id} pestId={p.pest_id} grade={t.grade} pestName={p.name_ko} /> : null;
                  })}
                </div>
              )}
              <FarmSite lat={f.lat} lon={f.lon} spot={f.spot_code} />
            </article>
          );
        })}
      </section>
    </div>
  );
}
