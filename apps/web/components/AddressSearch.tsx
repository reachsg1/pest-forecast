"use client";

import { useState } from "react";
import { Icon } from "./ui";

export type GeoHit = { label: string; sub: string; lat: number; lon: number; source: string };

/** 주소·장소 검색창(/api/geocode). 결과를 고르면 onPick(좌표·이름) */
export default function AddressSearch({ onPick, dark = false, placeholder = "주소·지명 검색 (예: 이천시 장호원읍)" }: { onPick: (h: GeoHit) => void; dark?: boolean; placeholder?: string }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<GeoHit[] | null>(null);
  const [busy, setBusy] = useState(false);

  // 다른 <form>(농장 추가) 안에 들어가므로 자체 form을 쓰지 않는다(중첩 form 방지) — Enter는 직접 처리
  async function search() {
    if (q.trim().length < 2) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/geocode?q=${encodeURIComponent(q.trim())}`);
      setHits(r.ok ? ((await r.json()).results as GeoHit[]) : []);
    } catch {
      setHits([]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <div className="flex gap-1.5" role="search" aria-label="주소 검색">
        <input
          className={dark ? "field-glass flex-1" : "field flex-1"}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setHits(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              search();
            }
          }}
          placeholder={placeholder}
          aria-label="주소 또는 지명"
        />
        <button type="button" onClick={search} className={dark ? "btn-glass px-3" : "btn-secondary px-3"} disabled={busy} aria-label="검색">
          {busy ? "…" : <Icon name="location" className="h-4 w-4" />}
        </button>
      </div>
      {hits && (
        <ul className="absolute inset-x-0 top-full z-30 mt-1 max-h-64 overflow-auto rounded-xl border border-slate-200 bg-white py-1 text-sm shadow-lift" role="listbox">
          {hits.length === 0 && <li className="px-3 py-2 text-xs text-slate-500">결과가 없어요. 시군·읍면 이름을 넣어 보세요.</li>}
          {hits.map((h, i) => (
            <li key={i}>
              <button
                type="button"
                className="block w-full px-3 py-2 text-left hover:bg-slate-50"
                onClick={() => {
                  onPick(h);
                  setHits(null);
                  setQ(h.label);
                }}
              >
                <span className="block truncate font-medium text-slate-800">{h.label}</span>
                {h.sub && <span className="block truncate text-xs text-slate-400">{h.sub}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
