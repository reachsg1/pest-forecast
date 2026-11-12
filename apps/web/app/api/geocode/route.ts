import { NextResponse } from "next/server";

/**
 * 주소·장소 검색 → 좌표 후보(최대 8개). 로그인한 이용자만(미들웨어).
 * 1순위 카카오 로컬 API(주소 → 없으면 키워드), KAKAO_CLIENT_ID(REST API 키) 사용.
 * 2순위 OpenStreetMap Nominatim(키 없음, 이용 정책상 저빈도 사용만) — 카카오 키가 없거나 결과가 없을 때.
 * 검색어·결과는 저장하지 않는다.
 */
type Hit = { label: string; sub: string; lat: number; lon: number; source: "kakao" | "osm" };

async function kakao(q: string, key: string): Promise<Hit[]> {
  const h = { Authorization: `KakaoAK ${key}` };
  const a = await fetch(`https://dapi.kakao.com/v2/local/search/address.json?size=8&query=${encodeURIComponent(q)}`, { headers: h }).catch(() => null);
  const aj = a?.ok ? ((await a.json()) as { documents?: { address_name: string; road_address?: { address_name: string } | null; x: string; y: string }[] }) : null;
  let out: Hit[] = (aj?.documents ?? []).map((d) => ({ label: d.road_address?.address_name || d.address_name, sub: d.road_address ? d.address_name : "", lat: Number(d.y), lon: Number(d.x), source: "kakao" }));
  if (!out.length) {
    const k = await fetch(`https://dapi.kakao.com/v2/local/search/keyword.json?size=8&query=${encodeURIComponent(q)}`, { headers: h }).catch(() => null);
    const kj = k?.ok ? ((await k.json()) as { documents?: { place_name: string; address_name: string; x: string; y: string }[] }) : null;
    out = (kj?.documents ?? []).map((d) => ({ label: d.place_name, sub: d.address_name, lat: Number(d.y), lon: Number(d.x), source: "kakao" }));
  }
  return out;
}

async function osm(q: string): Promise<Hit[]> {
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&countrycodes=kr&accept-language=ko&q=${encodeURIComponent(q)}`, {
    headers: { "User-Agent": "pest-forecast/0.1 (address search)" },
  }).catch(() => null);
  const j = r?.ok ? ((await r.json()) as { display_name: string; lat: string; lon: string }[]) : [];
  return j.map((d) => ({ label: d.display_name.split(",").slice(0, 3).join(","), sub: d.display_name, lat: Number(d.lat), lon: Number(d.lon), source: "osm" }));
}

export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 100);
  if (q.length < 2) return NextResponse.json({ results: [] });
  const key = process.env.KAKAO_CLIENT_ID?.trim();
  let results: Hit[] = key ? await kakao(q, key) : [];
  if (!results.length) results = await osm(q);
  return NextResponse.json({ results: results.filter((h) => h.lat > 32 && h.lat < 39.5 && h.lon > 124 && h.lon < 132) });
}
