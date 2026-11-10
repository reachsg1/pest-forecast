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

export interface EvalSummary {
  status: string;
  note?: string;
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
  type: "A" | "B" | "C";
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
}

export interface RiskFile {
  pest_id: string;
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

export interface SpotFile {
  spot: Spot & { zone_code?: string };
  issued_date: string;
  missing_rate: number;
  phenology?: Record<string, PhenologyInfo>; // crop → 판정 근거
  series: Record<string, SeriesPoint[]>;
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
