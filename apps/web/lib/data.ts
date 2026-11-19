// 서버 컴포넌트·API 라우트에서 public/data/*.json 을 읽는다.
// 클라이언트 컴포넌트는 fetch("/data/...") 로 같은 파일을 받는다.
import { promises as fs } from "fs";
import { headers } from "next/headers";
import path from "path";
import { ROLE_HEADER } from "./auth";
import type { PestCard, RiskFile, Spot, SpotFile, Status, Summary } from "./types";

const DATA_DIR = path.join(process.cwd(), "public", "data");

async function readJson<T>(rel: string): Promise<T | null> {
  try {
    const txt = await fs.readFile(path.join(DATA_DIR, rel), "utf-8");
    return JSON.parse(txt) as T;
  } catch {
    return null;
  }
}

// 서비스 노출: 예찰 검증 기준(pipeline/service.py)을 통과한 병해충만 일반 화면에. 관리자 화면은 getAll* 을 쓴다
const listed = (x: { listed?: boolean; service?: { listed?: boolean } }) => (x.service?.listed ?? x.listed) !== false;
export const getAllSummary = () => readJson<Summary>("summary.json");
export const getSummary = async () => {
  const s = await getAllSummary();
  return s ? { ...s, pests: s.pests.filter(listed) } : s;
};
export const getStatus = () => readJson<Status>("status.json");
export const getSpots = async () => (await readJson<Spot[]>("spots.json")) ?? [];
export const getAllPests = async () => (await readJson<PestCard[]>("pests.json")) ?? [];
/** 요청한 사람이 관리자인가(미들웨어가 넘긴 역할 헤더). 요청 밖(빌드·그림 생성)에서는 일반 이용자로 본다 */
export async function isAdminRequest(): Promise<boolean> {
  try {
    return (await headers()).get(ROLE_HEADER) === "admin";
  } catch {
    return false;
  }
}
/** 기존 규칙형(기본 폴더) 모델 이름 — 검증 비교표의 기준 줄에 쓴다 */
export const ruleLabel = (p: PestCard) => p.rule_label ?? p.models?.find((m) => !m.model_id.includes("__"))?.label;
/** 일반 이용자에게는 서비스 모델(기본 모델, 예찰 검증 통과) 하나만 — 비교용 모델(규칙형·로지스틱·RF·XGBoost)은 관리자만 */
const serviceModelOnly = (p: PestCard): PestCard => {
  const ms = p.models ?? [];
  const def = ms.find((m) => m.is_default) ?? ms[0];
  return def ? { ...p, models: [def], rule_label: ruleLabel(p) } : p;
};
export const getPests = async () => {
  const [all, admin] = await Promise.all([getAllPests(), isAdminRequest()]);
  const ps = all.filter(listed);
  return admin ? ps : ps.map(serviceModelOnly);
};
/** 상세: 서비스 제외 병해충도 찾는다(화면에서 관리자만 보이게 막음). 일반 이용자에게는 서비스 모델만 */
export const getPest = async (id: string) => {
  const [all, admin] = await Promise.all([getAllPests(), isAdminRequest()]);
  const p = all.find((x) => x.pest_id === id) ?? null;
  return p && !admin ? serviceModelOnly(p) : p;
};
export const getRisk = (pestId: string) => readJson<RiskFile>(`risk/${safe(pestId)}.json`);
export const getSpotFile = (code: string) => readJson<SpotFile>(`spot/${safe(code)}.json`);

function safe(id: string): string {
  return id.replace(/[^A-Za-z0-9_\-]/g, "");
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
