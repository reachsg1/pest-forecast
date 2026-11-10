"""경로·환경변수·외부 API 설정.

외부 API의 응답 태그명은 기술명세서(HWP)에 있어 여기서는 '후보 태그' 목록으로 둔다.
``python -m pipeline.cli probe`` 로 실제 응답을 확인한 뒤 FIELD_CANDIDATES를 다듬는다.
"""
from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]
MODELS_DIR = ROOT / "models"
DATA_DIR = ROOT / "data"
REFERENCE_DIR = DATA_DIR / "reference"
PREDICTIONS_DIR = DATA_DIR / "predictions"
CACHE_DIR = DATA_DIR / "cache"
WEB_DATA_DIR = ROOT / "apps" / "web" / "public" / "data"

HORIZON_DAYS_DEFAULT = 10
HISTORY_DAYS_SHOWN = 30          # 화면 추이 차트에 보여줄 과거 일수
REQUEST_TIMEOUT = 20
RETRIES = 3
RETRY_BACKOFF_SEC = 2.0

# 생물계절(재배 여부·재배 시기) 판정 — pipeline/phenology.py
CULTIVATION_CSV = REFERENCE_DIR / "cultivation.csv"      # 시군별 작물 재배면적
CROP_CALENDAR_YAML = REFERENCE_DIR / "crop_calendar.yaml"  # 권역·시도·시군별 재배 기간
# 시군 재배면적이 이 값(ha) 이하이면 '비재배지'로 본다(정책값).
# 2026-11-10 사용자 결정: 1 ha — 텃밭 수준의 소규모 등록만 걸러내는 보수적 기준.
# 2025 농업경영체 등록정보 기준 전국 209개 시군 중 비재배지: 사과 44, 벼 31, 고추 21곳.
MIN_CULTIVATION_HA = 1.0


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def normalize_key(key: str) -> str:
    """공공데이터포털 키는 URL 인코딩된 형태로 발급된다. requests가 다시 인코딩하므로 디코딩해 둔다."""
    if "%" in key:
        return unquote(key)
    return key


def ncpms_key() -> str:
    return _env("NCPMS_API_KEY")


def data_go_kr_key() -> str:
    return normalize_key(_env("DATA_GO_KR_KEY"))


def kma_key() -> str:
    return normalize_key(_env("KMA_API_KEY") or _env("DATA_GO_KR_KEY"))


# --- 국립농업과학원 농업기상 (농업날씨365) ---------------------------------
AGRI_BASE = "https://apis.data.go.kr/1390802/AgriWeather"
AGRI_SPOT_LIST = f"{AGRI_BASE}/getObsrSpotList"
AGRI_DAILY_MONTH = f"{AGRI_BASE}/WeatherObsrInfo/V2/GnrlWeather/getWeatherMonDayList"
AGRI_DAILY_RANGE = f"{AGRI_BASE}/WeatherObsrInfo/V2/GnrlWeather/getWeatherTermDayList"  # 기간 조회(확인 필요)
AGRI_PAGE_SIZE = 100

# 응답 XML 태그 → 내부 필드. 후보를 순서대로 찾는다. (probe로 확인 후 수정)
FIELD_CANDIDATES: dict[str, list[str]] = {
    "spot_code": ["obsr_Spot_Code", "stn_Code", "spot_Code", "stnCode"],
    "spot_name": ["obsr_Spot_Nm", "stn_Name", "spot_Name", "stnName"],
    "lat": ["lat", "latitude", "stn_Lat", "obsr_Lat"],
    "lon": ["lon", "lng", "longitude", "stn_Lon", "obsr_Lon"],
    "altitude": ["altitude", "alt", "stn_Alt", "obsr_Alt"],
    "sigungu": ["sigungu", "area", "addr", "obsr_Addr", "stn_Addr"],
    "zone_code": ["zone_Code", "zoneCode"],
    "date": ["date", "obsr_Date", "ymd", "obsr_Ymd"],
    "tavg": ["temp", "avg_Temp", "tavg", "temp_Avg"],
    "tmax": ["max_Temp", "tmax", "temp_Max"],
    "tmin": ["min_Temp", "tmin", "temp_Min"],
    "rh": ["hum", "avg_Hum", "rh", "hum_Avg"],
    "rain": ["rain", "sum_Rain", "rainfall", "rain_Sum"],
    "wind": ["wind", "avg_Wind", "wind_Avg"],
    "sunshine": ["sun_Time", "sunshine", "sum_Sun_Time"],
    "radiation": ["sun_Qy", "radiation", "sum_Sun_Qy"],
    "condens_hours": ["condens_Time", "dew_Time", "lwd"],
    "soil_moist": ["soil_Wt", "soil_Moist", "soil_Wt_10"],
}

# --- 기상청 단기예보 (공공데이터포털) ---------------------------------------
KMA_VILAGE_FCST = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst"
KMA_BASE_TIMES = ["0200", "0500", "0800", "1100", "1400", "1700", "2000", "2300"]

# --- NCPMS 오픈API --------------------------------------------------------
NCPMS_BASE = "http://ncpms.rda.go.kr/npmsAPI/service"
# 확인된 코드: SVC01 병 검색, SVC05 병 상세(sickKey). 해충 SVC03/SVC07은 통용되는 값.
# 예찰·예측·발생정보 코드는 NCPMS 'OpenAPI 안내' 화면에서 확인 후 채운다.
NCPMS_SERVICE_CODES = {
    "disease_search": "SVC01",
    "disease_detail": "SVC05",
    "insect_search": "SVC03",
    "insect_detail": "SVC07",
    "occurrence_info": "",     # TODO: 발생정보(예보·주의보·경보)
    "survey_result": "",       # TODO: 예찰 결과
    "forecast_map": "",        # TODO: 예측 지도
}


def ensure_dirs() -> None:
    for p in (PREDICTIONS_DIR, CACHE_DIR, WEB_DATA_DIR, WEB_DATA_DIR / "risk", WEB_DATA_DIR / "spot"):
        p.mkdir(parents=True, exist_ok=True)
