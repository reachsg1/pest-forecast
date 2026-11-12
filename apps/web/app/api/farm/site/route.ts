import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import soilCodes from "@/lib/ref/soil_codes.json";
import { haversineKm, toUtmK } from "@/lib/geo";

/**
 * 내 농장 위치 정보(로그인 이용자만, 결과 저장 안 함):
 *  - 해발고도: Open-Meteo Elevation API(Copernicus DEM 90m, 키 없음)
 *  - 가까운 관측지점 고도와의 차이 → 기온 보정(감률 6.5℃/km, 국제표준대기) — 위험도 계산에는 아직 쓰지 않고 안내만
 *  - 팜맵(농림축산식품부, data.go.kr 15057368): 좌표 반경 안 농경지 필지(논·밭·과수 등), 필지 번호(PNU)
 *  - 토양(농촌진흥청 토양특성 상세 V3, data.go.kr 15144225): 필지 번호로 배수·토심·토성·적성 — 코드표 lib/ref/soil_codes.json
 *    공공누리 제4유형(출처표시·상업적 이용금지·변경금지): 코드를 이름으로만 바꿔 보여 주고 가공하지 않는다
 * 필요 환경변수: DATA_GO_KR_KEY(팜맵·토양). 없으면 고도만 돌려준다.
 */
const LAPSE = 0.0065;
type Codes = { fields: Record<string, { name: string; codes: Record<string, string> }> };
const CODES = soilCodes as Codes;
const SHOW = ["Main_Landuse_Cd", "Soildra_Cd", "Vldsoildep_Cd", "Surtture_Cd", "Sur_Ston_Cd", "Pfld_Grd_Cd", "Upland_Factor_Cd", "Fruit_Grd_Cd", "Rfld_Grd_Cd", "Soil_Type_Geo_Cd"];

function key(): string {
  const k = process.env.DATA_GO_KR_KEY?.trim() ?? "";
  try {
    return k.includes("%") ? decodeURIComponent(k) : k;
  } catch {
    return k;
  }
}

async function elevation(lat: number, lon: number): Promise<number | null> {
  const r = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`).catch(() => null);
  const j = r?.ok ? ((await r.json()) as { elevation?: number[] }) : null;
  const v = j?.elevation?.[0];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

type Parcel = { pnu: string; type: string; emd: string; lnm: string; year: string };

async function parcels(lat: number, lon: number, k: string): Promise<Parcel[]> {
  const { x, y } = toUtmK(lat, lon);
  for (const radius of [50, 200, 500]) {
    const q = new URLSearchParams({ serviceKey: k, type: "json", numOfRows: "20", pageNo: "1", positionX: String(x), positionY: String(y), radius: String(radius) });
    const r = await fetch(`https://apis.data.go.kr/B552895/getFarmmapService/getAreaBasedFarmmapInfo?${q}`).catch(() => null);
    const j = r?.ok ? await r.json().catch(() => null) : null;
    const items = j?.response?.body?.items?.item;
    const list = (Array.isArray(items) ? items : items ? [items] : []) as Record<string, string>[];
    if (list.length) {
      return list.map((i) => ({ pnu: i.pnuLnmCd, type: i.intprNm, emd: i.lglEmdNm, lnm: i.lnm, year: (i.vdptYr || "").slice(0, 4) }));
    }
  }
  return [];
}

async function soil(pnu: string, k: string): Promise<{ name: string; value: string }[] | null> {
  const r = await fetch(`https://apis.data.go.kr/1390802/SoilEnviron/SoilCharac/V3/getSoilCharacter?${new URLSearchParams({ serviceKey: k, PNU_CD: pnu })}`).catch(() => null);
  const xml = r?.ok ? await r.text() : "";
  const got: Record<string, string> = {};
  for (const m of xml.matchAll(/<(\w+_Cd)>([^<]*)<\/\1>/g)) got[m[1]] = m[2];
  const rows = SHOW.filter((t) => got[t]).map((t) => ({ name: CODES.fields[t]?.name ?? t, value: CODES.fields[t]?.codes[got[t]] ?? got[t] }));
  return rows.length ? rows : null;
}

export async function GET(req: Request) {
  const u = new URL(req.url);
  const lat = Number(u.searchParams.get("lat"));
  const lon = Number(u.searchParams.get("lon"));
  const spot = u.searchParams.get("spot") ?? "";
  if (!(lat > 32 && lat < 39.5 && lon > 124 && lon < 132)) return NextResponse.json({ error: "좌표가 우리나라 범위 밖이에요" }, { status: 400 });

  const spots = JSON.parse(await fs.readFile(path.join(process.cwd(), "public", "data", "spots.json"), "utf-8")) as { spot_code: string; name: string; lat: number; lon: number; altitude: number | null }[];
  const st = spots.find((s) => s.spot_code === spot);
  const elev = await elevation(lat, lon);
  const out: Record<string, unknown> = {
    elevation: elev,
    elevation_source: "Open-Meteo Elevation API(Copernicus DEM 90m)",
    station: st ? { name: st.name, altitude: st.altitude, distance_km: Math.round(haversineKm(lat, lon, st.lat, st.lon) * 10) / 10 } : null,
    lapse_dt: elev != null && st?.altitude != null ? Math.round(-LAPSE * (elev - st.altitude) * 10) / 10 : null,
  };
  const k = key();
  if (!k) return NextResponse.json({ ...out, farmmap: null, soil: null, note: "DATA_GO_KR_KEY가 없어 필지·토양 정보를 불러오지 못했어요" });
  const ps = await parcels(lat, lon, k);
  out.farmmap = ps.slice(0, 5);
  // 토양: 가장 가까운(첫) 농경지 필지부터 값이 있는 곳까지 최대 3필지
  for (const p of ps.slice(0, 3)) {
    const s = await soil(p.pnu, k);
    if (s) {
      out.soil = { parcel: `${p.emd} ${p.lnm}`, type: p.type, items: s, source: "농촌진흥청 국립농업과학원 토양특성 상세정보(공공누리 제4유형)" };
      break;
    }
  }
  out.soil ??= null;
  return NextResponse.json(out);
}
