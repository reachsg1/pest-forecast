import type { PestCard } from "./types";

/** 모델 입력 변수 사전 — 관리자 '데이터 명세' 화면. 계산은 models/_base/stat.compute_features, pipeline/asos.py, pipeline/terrain.py 와 같다. */
export type FeatureGroup = "agri" | "asos" | "survey" | "terrain" | "season";

export const GROUPS: Record<FeatureGroup, { name: string; source: string; detail: string; tone: string; dot: string }> = {
  agri: {
    name: "농업기상 관측",
    source: "국립농업과학원 농업기상 관측(206곳) 일자료 + 기상청 단기·중기예보",
    detail: "지점(관측소)마다 그날 전날까지 관측. 앞으로 7일은 예보로 이어 붙인다.",
    tone: "bg-emerald-50 text-emerald-700 ring-emerald-200", dot: "bg-emerald-500",
  },
  asos: {
    name: "기상청 ASOS",
    source: "기상청 지상(종관) ASOS 일자료(98곳)",
    detail: "농업기상에 없는 항목만. 가장 가까운 ASOS 시군의 전날까지 값, 예보 날짜는 발행일 값.",
    tone: "bg-sky-50 text-sky-700 ring-sky-200", dot: "bg-sky-500",
  },
  survey: {
    name: "NCPMS 예찰",
    source: "국가농작물병해충관리시스템 시군 예찰 조사값",
    detail: "같은 해 직전 회차 값. 그 시군 조사가 없으면 가장 가까운 예찰 시군.",
    tone: "bg-amber-50 text-amber-700 ring-amber-200", dot: "bg-amber-500",
  },
  terrain: {
    name: "시군 지형",
    source: "국토지리정보원 수치표고모델 90m",
    detail: "시군 안 완경사지(경사 7° 미만 = 농경지가 있을 만한 곳) 요약. 해마다 바뀌지 않는 값.",
    tone: "bg-violet-50 text-violet-700 ring-violet-200", dot: "bg-violet-500",
  },
  season: {
    name: "시기",
    source: "날짜",
    detail: "같은 날씨라도 시기에 따라 발생이 다른 것을 반영.",
    tone: "bg-slate-100 text-slate-600 ring-slate-200", dot: "bg-slate-400",
  },
};

export type FeatureDef = { code: string; group: FeatureGroup; name: string; calc: string; unit: string };

export const FEATURES: FeatureDef[] = [
  { code: "tavg_14d", group: "agri", name: "평균기온", calc: "최근 14일 평균", unit: "℃" },
  { code: "tavg_30d", group: "agri", name: "평균기온", calc: "최근 30일 평균", unit: "℃" },
  { code: "tmin_7d", group: "agri", name: "최저기온", calc: "최근 7일 평균", unit: "℃" },
  { code: "rh_14d", group: "agri", name: "상대습도", calc: "최근 14일 평균", unit: "%" },
  { code: "rh_30d", group: "agri", name: "상대습도", calc: "최근 30일 평균", unit: "%" },
  { code: "rain_14d", group: "agri", name: "강수량", calc: "최근 14일 합", unit: "mm" },
  { code: "rain_days_14d", group: "agri", name: "비 온 날", calc: "최근 14일 중 1 mm 이상인 날", unit: "일" },
  { code: "rain_days_30d", group: "agri", name: "비 온 날", calc: "최근 30일 중 1 mm 이상인 날", unit: "일" },
  { code: "lwd_14d", group: "agri", name: "잎 젖음 시간", calc: "최근 14일 하루 평균(관측, 없으면 습도·강우로 추정)", unit: "시간" },
  { code: "lwd_30d", group: "agri", name: "잎 젖음 시간", calc: "최근 30일 하루 평균", unit: "시간" },
  { code: "rain_days_season", group: "agri", name: "시즌 비 온 날", calc: "6월 1일부터 1 mm 이상인 날", unit: "일" },
  { code: "wet_warm_days_season", group: "agri", name: "시즌 따뜻한 비 날", calc: "6월 1일부터 비 오고 평균기온 20~30℃인 날", unit: "일" },
  { code: "a_sun_14d", group: "asos", name: "일조시간", calc: "최근 14일 하루 평균", unit: "시간" },
  { code: "a_rad_14d", group: "asos", name: "일사량", calc: "최근 14일 하루 평균(측정 지점만)", unit: "MJ/m²" },
  { code: "a_rndur_14d", group: "asos", name: "강수 지속시간", calc: "최근 14일 합(측정 지점만)", unit: "시간" },
  { code: "a_rndur_season", group: "asos", name: "시즌 강수 지속시간", calc: "6월 1일부터 합(측정 지점만)", unit: "시간" },
  { code: "a_wind_14d", group: "asos", name: "풍속", calc: "최근 14일 평균", unit: "m/s" },
  { code: "a_td_14d", group: "asos", name: "이슬점온도", calc: "최근 14일 평균", unit: "℃" },
  { code: "a_cloud_14d", group: "asos", name: "구름양", calc: "최근 14일 평균 전운량", unit: "1/10" },
  { code: "a_rhmin_14d", group: "asos", name: "최저습도", calc: "최근 14일 평균", unit: "%" },
  { code: "a_humid_days_14d", group: "asos", name: "습한 날", calc: "최근 14일 중 평균습도 85% 이상인 날", unit: "일" },
  { code: "prev_survey_log", group: "survey", name: "직전 예찰값", calc: "같은 해 직전 회차 조사값, log(1+값)", unit: "" },
  { code: "sgg_elev_gentle", group: "terrain", name: "재배지 고도", calc: "완경사지 평균 해발고도", unit: "m" },
  { code: "sgg_tpi_1k_gentle", group: "terrain", name: "골짜기·능선(좁게)", calc: "완경사지의 고도 − 반경 0.5 km 평균(음수 = 골짜기)", unit: "m" },
  { code: "sgg_tpi_4k_gentle", group: "terrain", name: "분지·평야(넓게)", calc: "같은 값, 반경 2 km", unit: "m" },
  { code: "sgg_dist_sea_km_gentle", group: "terrain", name: "바다까지 거리", calc: "완경사지 평균", unit: "km" },
  { code: "sgg_gentle_share", group: "terrain", name: "완경사지 비율", calc: "시군 땅 중 경사 7° 미만", unit: "비율" },
  { code: "sgg_steep_share", group: "terrain", name: "급경사지 비율", calc: "시군 땅 중 경사 15° 이상", unit: "비율" },
  { code: "sgg_relief_5k_mean", group: "terrain", name: "기복", calc: "반경 2.5 km 최고−최저 고도, 시군 평균", unit: "m" },
  { code: "sgg_northness_mean", group: "terrain", name: "북향 정도", calc: "사면 방향 cos, 시군 평균(1 = 북사면)", unit: "" },
  { code: "doy", group: "season", name: "연중 날짜", calc: "1월 1일부터 며칠째", unit: "일" },
];

export const FEATURE_BY_CODE = new Map(FEATURES.map((f) => [f.code, f]));

/** 모델 카드 params.features(문자열 또는 {name}) → 변수 코드 목록 */
export function featureCodes(m: { params: Record<string, unknown> }): string[] {
  const fs = (m.params?.features as unknown[]) ?? [];
  return fs.map((f) => (typeof f === "string" ? f : (f as { name?: string })?.name ?? "")).filter(Boolean);
}

export function groupOf(code: string): FeatureGroup {
  return FEATURE_BY_CODE.get(code)?.group ?? (code.startsWith("a_") ? "asos" : code.startsWith("sgg_") || code.startsWith("site_") ? "terrain" : "agri");
}

/** 병해충의 학습 모델(RF·XGB·로지스틱)이 쓰는 변수 합집합 */
export function pestFeatureCodes(p: PestCard): string[] {
  const set = new Set<string>();
  for (const m of p.models ?? []) for (const c of featureCodes(m)) set.add(c);
  return Array.from(set);
}
