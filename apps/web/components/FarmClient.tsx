"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import RiskBadge from "./RiskBadge";
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
    if (!name.trim() || !crop || !Number.isFinite(la) || !Number.isFinite(lo)) {
      setMsg("농장 이름, 작물, 위도·경도를 입력하세요.");
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
    <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
      <form
        className="space-y-3 rounded-lg border bg-white p-4 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <h2 className="font-semibold">농장 추가</h2>
        <label className="block">
          <span className="text-gray-600">농장 이름</span>
          <input className="mt-1 w-full rounded border px-2 py-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 뒷밭 사과원" />
        </label>
        <label className="block">
          <span className="text-gray-600">작물</span>
          <select className="mt-1 w-full rounded border px-2 py-1" value={crop} onChange={(e) => setCrop(e.target.value)}>
            {crops.map((c) => (
              <option key={c} value={c}>
                {pests.find((p) => p.crop === c)?.crop_ko ?? c}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-gray-600">위도</span>
            <input className="mt-1 w-full rounded border px-2 py-1" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="36.5" />
          </label>
          <label className="block">
            <span className="text-gray-600">경도</span>
            <input className="mt-1 w-full rounded border px-2 py-1" inputMode="decimal" value={lon} onChange={(e) => setLon(e.target.value)} placeholder="127.5" />
          </label>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={locate} className="rounded border px-3 py-1 hover:bg-gray-50">
            현재 위치 사용
          </button>
          <button type="submit" className="rounded bg-brand px-3 py-1 font-semibold text-white hover:bg-brand-dark">
            추가
          </button>
        </div>
        {msg && <p className="text-xs text-red-700">{msg}</p>}
        <p className="text-xs text-gray-500">주소 검색(지오코딩)은 2단계에서 연결합니다. 지금은 지도 앱에서 좌표를 복사해 넣어 주세요.</p>
      </form>

      <section className="space-y-3">
        {farms.length === 0 && <p className="rounded-lg border border-dashed bg-white p-6 text-center text-sm text-gray-500">등록된 농장이 없습니다.</p>}
        {farms.map((f) => {
          const file = files[f.spot_code];
          const myPests = pests.filter((p) => p.crop === f.crop);
          return (
            <article key={f.id} className="rounded-lg border bg-white p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-base font-bold">{f.name}</h3>
                  <p className="text-xs text-gray-600">
                    {pests.find((p) => p.crop === f.crop)?.crop_ko} · 최근접 관측지점 {file?.spot.name ?? f.spot_code} ({f.distance_km} km)
                  </p>
                </div>
                <button onClick={() => save(farms.filter((x) => x.id !== f.id))} className="text-xs text-gray-500 underline">
                  삭제
                </button>
              </div>
              {!file ? (
                <p className="mt-2 text-sm text-gray-500">불러오는 중…</p>
              ) : (
                <table className="mt-3 w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-600">
                      <th className="py-1 pr-2">병해충</th>
                      <th className="py-1 pr-2">오늘</th>
                      <th className="py-1">{horizon}일 타임라인</th>
                    </tr>
                  </thead>
                  <tbody>
                    {myPests.map((p) => {
                      const s = (file.series[p.pest_id] ?? []).filter((x) => x.offset >= 0 && x.offset <= horizon);
                      const today = s.find((x) => x.offset === 0);
                      return (
                        <tr key={p.pest_id} className="border-t">
                          <td className="py-1.5 pr-2">
                            <Link href={`/pests/${p.pest_id}?spot=${f.spot_code}&tab=trend`} className="hover:underline">
                              {p.name_ko}
                            </Link>
                          </td>
                          <td className="py-1.5 pr-2">{today ? <RiskBadge grade={today.grade} index={today.index} na={today.na_reason} size="sm" /> : "-"}</td>
                          <td className="py-1.5">
                            <div className="flex gap-0.5" role="img" aria-label={s.map((x) => `${x.offset}일 ${x.grade ?? NA.label}`).join(", ")}>
                              {s.map((x) =>
                                x.grade == null ? (
                                  // 해당 없음: 빈 칸(점선 테두리)으로 등급색과 구분
                                  <span key={x.offset} title={`+${x.offset}일 ${NA.label}${x.na_reason ? " · " + NA_REASONS[x.na_reason].short : ""}`} className="h-4 flex-1 rounded-sm border border-dashed border-gray-300 bg-white" />
                                ) : (
                                  <span key={x.offset} title={`+${x.offset}일 ${x.grade} ${fmtIndex(x.index)}`} className="h-4 flex-1 rounded-sm" style={{ background: gradeMeta(x.grade).color, opacity: x.offset === 0 ? 1 : 0.75 }} />
                                ),
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </article>
          );
        })}
      </section>
    </div>
  );
}
