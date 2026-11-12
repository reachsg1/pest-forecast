// 파이프라인(pipeline/publish.py)이 만드는 JSON의 형태

export type Grade = "정상" | "예보" | "주의보" | "경보";

// 생물계절 판정으로 위험도를 내지 않은 사유. 등급이 아니다(4단계 등급은 고정).
export type NaReason = "not_grown" | "off_season";

// 지점 × 작물의 재배 여부·재배 기간 판정 근거 (pipeline/phenology.py SpotCrop.to_dict)
export interface PhenologyInfo {
  cultivation: "grown" | "not_grown" | "unknown";
  area_ha: number | null;
  cultivation_source: string;
  window: string | null; // "MM-DD~MM-DD"
  window_level: "sigungu" | "sido" | "zone" | "national" | null;
  window_region: string | null;
  window_source: string | null;
}

export interface Spot {
  spot_code: string;
  name: string;
  lat: number | null;
  lon: number | null;
  altitude?: number | null;
  sigungu: string;
  missing_rate: number;
  data_poor: boolean;
}

// 예찰 학습형 모델의 연도 분리 검증 결과(pipeline/survey_train.py)
export interface SurveyEvalBlock {
  n: number;
  positive_rate: number;
  auc: { survey_logit: number; climatology: number; default_rule: number; persistence?: number; gbm_reference?: number };
  within_round_auc: { survey_logit: number; climatology: number; default_rule: number; persistence?: number };
  brier: { survey_logit: number; climatology: number; constant_rate?: number; gbm_reference?: number };
  // 위험지수 50(주의보) 이상을 '발생'으로 볼 때
  classification?: Record<string, { accuracy: number | null; precision: number | null; recall: number | null; f1: number | null }>;
}

export interface EvalSummary {
  status: string;
  note?: string;
  method?: string;
  n_sigungu?: number;
  test?: SurveyEvalBlock;
  test_by_year?: Record<string, SurveyEvalBlock>;
  with_history_reference?: { note: string; test: SurveyEvalBlock };
  uses_survey?: boolean; // 최근 예찰값을 입력으로 쓰는 모델
  algorithm?: string;
  substituted?: { n: number; n_sigungu: number; max_km: number };
  years?: Record<
    string,
    {
      n_obs: number;
      hit_rate: number | null;
      precision: number | null;
      recall: number | null;
      mean_lead_days: number | null;
      confusion: { tp: number; fp: number; fn: number; tn: number };
    }
  >;
}

export interface PestCard {
  id: string;
  pest_id: string;
  name_ko: string;
  name_sci: string;
  crop: string;
  crop_ko: string;
  kind: "disease" | "insect";
  type: "A" | "B" | "C" | "D" | "E";
  version: string;
  horizon_days: number;
  season: { start_month: number; end_month: number };
  inputs: string[];
  params: Record<string, unknown>;
  ncpms_key: string;
  ncpms_kind: string;
  description: string;
  logic: string;
  references: string[];
  owner: string;
  status: string;
  eval: EvalSummary;
  control?: { name: string; environment: string; symptoms: string; control: string; image: string };
  label?: string;
  demo_only?: boolean;
  // 같은 병해충의 여러 모델(첫 번째가 기본 모델). 지도에서 골라 볼 수 있다.
  default_model?: string;
  models?: ModelVariant[];
}

// 병해충 1종에 붙은 모델 1개(카드 전체 + 식별 정보)
export interface ModelVariant extends Omit<PestCard, "models" | "default_model" | "control"> {
  model_id: string;
  label: string;
  is_default: boolean;
}

// 지도·목록에서 쓰는 모델 요약
export interface ModelLite {
  model_id: string;
  label: string;
  type: string;
  is_default: boolean;
  demo_only?: boolean;
  algorithm?: string; // 예: XGBoost, Random Forest, 로지스틱 회귀
  // 학습에 쓰지 않은 해로 시험한 성능(예찰 학습형만). 없으면 검증 전
  perf?: { auc: number; accuracy: number | null; within: number } | null;
}

export interface RiskSpotEntry {
  spot_code: string;
  name: string;
  lat: number | null;
  lon: number | null;
  sigungu: string;
  data_poor: boolean;
  // null = 해당 없음(na_today에 사유)
  index_today: number | null;
  grade_today: Grade | null;
  na_today?: NaReason | null;
  index_by_offset: (number | null)[];
  grade_by_offset: (Grade | null)[];
  na_by_offset?: (NaReason | null)[];
  max_index_7d: number | null;
  max_index_10d: number | null;
  phenology?: PhenologyInfo | null;
  survey_ref?: SurveyRef | null;
}

// 예찰값을 쓰는 모델이 그날 계산에 쓴 예찰(시군·조사일·값·대체 거리)
export interface SurveyRef {
  date: string;
  value: number;
  sigungu: string;
  distance_km: number;
}

export interface RiskFile {
  pest_id: string;
  model_id?: string;
  model_label?: string;
  model_type?: string;
  is_default?: boolean;
  name_ko: string;
  crop: string;
  issued_date: string;
  horizon_days: number;
  offsets: number[];
  spots: RiskSpotEntry[];
}

export interface SeriesPoint {
  date: string;
  offset: number;
  index: number | null;
  grade: Grade | null;
  na_reason?: NaReason | null;
  is_forecast: boolean;
  inputs: Record<string, unknown>;
}

export interface WeatherDay {
  date: string;
  tavg: number | null;
  tmax: number | null;
  tmin: number | null;
  rh: number | null;
  rain: number | null;
  lwd_hours: number | null;
  sunshine: number | null;
  is_forecast: boolean;
  is_interpolated: boolean;
}

/** 관측지점 지형 요약(국토지리정보원 90m DEM) */
export interface TerrainInfo {
  elev: number | null;
  slope: number | null;
  aspect: string | null;
  position: string | null;
  tpi_1k: number | null;
  dist_sea_km: number | null;
  sgg_key: string;
  sgg_elev_gentle: number | null;
  lapse_dt: number | null;
  source: string;
}

export interface SpotFile {
  spot: Spot & { zone_code?: string };
  issued_date: string;
  missing_rate: number;
  phenology?: Record<string, PhenologyInfo>; // crop → 판정 근거
  terrain?: TerrainInfo | null; // 지형(DEM) 요약 — pipeline/terrain.py describe
  series: Record<string, SeriesPoint[]>; // pest_id → 기본 모델 시계열
  series_by_model?: Record<string, SeriesPoint[]>; // model_id → 추가 모델 시계열
  weather: WeatherDay[];
}

export interface SummaryPest {
  pest_id: string;
  name_ko: string;
  crop: string;
  crop_ko: string;
  type: string;
  in_season: boolean;
  grade_counts: Record<Grade, number>;
  na_count?: number;
  n_applicable?: number;
  max_grade: Grade | null; // 모든 지점이 해당 없음이면 null
  top_spots: { spot_code: string; name: string; index: number; grade: Grade }[];
  trend_7d: (number | null)[];
}

export interface Summary {
  issued_date: string;
  generated_at: string;
  horizon_days: number;
  mode: "demo" | "live";
  grade_counts_all: Record<Grade, number>;
  na_all?: number;
  n_spots: number;
  n_models: number;
  pests: SummaryPest[];
}

export interface Status {
  ok: boolean;
  mode: "demo" | "live";
  issued_date: string;
  generated_at: string;
  n_spots: number;
  n_models: number;
  n_rows: number;
  mean_missing_rate: number | null;
  data_poor_spots: string[];
  warnings: string[];
  grades: { name: Grade; min: number; max: number }[];
  phenology?: { source: string; min_area_ha: number; cultivation_crops: string[]; calendar_crops: string[] };
}
