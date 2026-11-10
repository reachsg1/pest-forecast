"""작물 생물계절 판정: 그 지점·그날에 해당 작물이 실제로 포장에 있는가.

작물이 재배되지 않는 지역이나 재배 기간이 아닌 날에 위험도를 내면 잘못된 정보가 된다.
그래서 모델 결과를 발행하기 전에 두 가지를 확인하고, 해당하지 않으면 위험지수 대신
'해당 없음'(등급 아님)으로 발행한다.

1) 재배 여부 — data/reference/cultivation.csv (시군별 작물 재배면적)
   지점의 시군에 그 작물 재배면적이 MIN_CULTIVATION_HA 이하이면 ``not_grown``.
   그 작물이 표에 아예 없으면 판단 근거가 없으므로 ``unknown``(차단하지 않음).
2) 재배 시기 — data/reference/crop_calendar.yaml (권역·시도·시군별 재배 기간)
   가장 구체적인 구역(시군 > 시도 > 권역 > 전국)의 기간 밖이면 ``off_season``.
   기간 자료가 없으면 ``unknown``(차단하지 않음).

모델 카드의 ``season``(병해충 활동 시기)과는 다르다. season 밖이라도 작물이 포장에 있으면
'정상'이 맞는 답이고, 작물 자체가 없으면 '해당 없음'이 맞는 답이다.
"""
from __future__ import annotations

import csv
import logging
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Optional

import yaml

log = logging.getLogger(__name__)

# 판정 결과 코드 (웹 lib/grades.ts NA_REASONS 와 맞춤)
OK = "ok"
NOT_GROWN = "not_grown"
OFF_SEASON = "off_season"
UNKNOWN = "unknown"

# 시도 명칭 → 약칭. 통계 원본(정식 명칭)과 지점 주소(약칭)를 같은 키로 맞춘다.
SIDO_ALIASES: dict[str, str] = {
    "서울특별시": "서울", "서울시": "서울", "서울": "서울",
    "부산광역시": "부산", "부산": "부산",
    "대구광역시": "대구", "대구": "대구",
    "인천광역시": "인천", "인천": "인천",
    "광주광역시": "광주", "광주": "광주",
    "대전광역시": "대전", "대전": "대전",
    "울산광역시": "울산", "울산": "울산",
    "세종특별자치시": "세종", "세종": "세종",
    "경기도": "경기", "경기": "경기",
    "강원도": "강원", "강원특별자치도": "강원", "강원": "강원",
    "충청북도": "충북", "충북": "충북",
    "충청남도": "충남", "충남": "충남",
    "전라북도": "전북", "전북특별자치도": "전북", "전북": "전북",
    "전라남도": "전남", "전남": "전남",
    "경상북도": "경북", "경북": "경북",
    "경상남도": "경남", "경남": "경남",
    "제주특별자치도": "제주", "제주도": "제주", "제주": "제주",
}

# 통계 원본의 품목명 → 모델 카드의 crop 코드
CROP_ALIASES: dict[str, str] = {
    "apple": "apple", "사과": "apple",
    "rice": "rice", "벼": "rice", "논벼": "rice", "쌀": "rice",
    "pepper": "pepper", "고추": "pepper", "건고추": "pepper", "노지고추": "pepper",
    "pear": "pear", "배": "pear",
    "peach": "peach", "복숭아": "peach",
}


def norm_sido(s: str) -> str:
    s = (s or "").strip()
    return SIDO_ALIASES.get(s, s[:2])


def region_key(address: str) -> tuple[str, str]:
    """'경기 수원시' / '경기도 수원시 장안구' → ('경기', '수원시'). 시군 단위까지만 쓴다."""
    parts = (address or "").split()
    if not parts:
        return ("", "")
    sido = norm_sido(parts[0])
    sigungu = parts[1] if len(parts) > 1 else ""
    return (sido, sigungu)


def _mmdd(s: str) -> tuple[int, int]:
    m, d = str(s).strip().split("-")
    return int(m), int(d)


@dataclass
class Window:
    """작물이 포장에 있는 기간(월-일). start > end 이면 해를 넘기는 작기.

    end가 비어 있으면(수확 종료 근거 없음) 시작일 이전만 '재배 시기 아님'으로 보고, 그 뒤는 연말까지 재배 중으로 둔다.
    """

    start: str
    end: Optional[str]
    level: str          # sigungu | sido | zone | national
    region: str
    source: str = ""
    status: str = "draft"

    def contains(self, d: date) -> bool:
        s = _mmdd(self.start)
        md = (d.month, d.day)
        if not self.end:
            return md >= s
        e = _mmdd(self.end)
        if s <= e:
            return s <= md <= e
        return md >= s or md <= e

    def label(self) -> str:
        return f"{self.start}~{self.end}" if self.end else f"{self.start}~(끝 미정)"


@dataclass
class SpotCrop:
    """지점 1곳 × 작물 1종의 판정 근거(날짜와 무관한 부분)."""

    cultivation: str            # grown | not_grown | unknown
    area_ha: Optional[float]
    cultivation_source: str
    window: Optional[Window]

    def status_on(self, d: date) -> str:
        if self.cultivation == "not_grown":
            return NOT_GROWN
        if self.window is not None and not self.window.contains(d):
            return OFF_SEASON
        return OK

    def to_dict(self) -> dict:
        return {
            "cultivation": self.cultivation,
            "area_ha": self.area_ha,
            "cultivation_source": self.cultivation_source,
            "window": self.window.label() if self.window else None,
            "window_level": self.window.level if self.window else None,
            "window_region": self.window.region if self.window else None,
            "window_source": self.window.source if self.window else None,
        }


@dataclass
class Phenology:
    # (crop, sido, sigungu) → (area_ha, year, source)
    cultivation: dict[tuple[str, str, str], tuple[float, int, str]] = field(default_factory=dict)
    zones: dict[str, list[str]] = field(default_factory=dict)          # 권역 → 시도 약칭
    windows: dict[str, list[Window]] = field(default_factory=dict)     # crop → 기간 목록
    min_area_ha: float = 0.0
    label: str = ""                                                    # 자료 출처 요약(상태 표시용)

    # --- 적재 ---------------------------------------------------------------
    @classmethod
    def load(cls, cultivation_csv: Path, calendar_yaml: Path, min_area_ha: float = 0.0) -> "Phenology":
        ph = cls(min_area_ha=min_area_ha)
        if cultivation_csv.exists():
            ph._load_cultivation(cultivation_csv)
        if calendar_yaml.exists():
            ph._load_calendar(calendar_yaml)
        return ph

    def _load_cultivation(self, path: Path) -> None:
        with path.open(encoding="utf-8-sig") as f:
            for r in csv.DictReader(f):
                crop = CROP_ALIASES.get((r.get("crop") or "").strip())
                if not crop:
                    continue
                try:
                    area = float(str(r.get("area_ha", "")).replace(",", "") or 0)
                    year = int(r.get("year") or 0)
                except ValueError:
                    continue
                key = (crop, norm_sido(r.get("sido", "")), (r.get("sigungu") or "").strip())
                prev = self.cultivation.get(key)
                if prev is None or year >= prev[1]:  # 같은 시군은 최신 연도만
                    self.cultivation[key] = (area, year, (r.get("source") or "").strip())

    def _load_calendar(self, path: Path) -> None:
        raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        self.zones = {k: [norm_sido(s) for s in (v or [])] for k, v in (raw.get("zones") or {}).items()}
        for crop, spec in (raw.get("crops") or {}).items():
            ws = []
            for w in (spec or {}).get("windows") or []:
                if not w.get("start"):
                    continue
                ws.append(Window(start=str(w["start"]), end=str(w["end"]) if w.get("end") else None, level=w.get("level", "national"),
                                 region=w.get("region", ""), source=w.get("source", ""), status=w.get("status", "draft")))
            if ws:
                self.windows[crop] = ws

    # --- 판정 ---------------------------------------------------------------
    def crops_with_cultivation(self) -> set[str]:
        return {c for (c, _, _) in self.cultivation}

    def crops_with_calendar(self) -> set[str]:
        return set(self.windows)

    def _zone_of(self, sido: str) -> Optional[str]:
        return next((z for z, members in self.zones.items() if sido in members), None)

    def window_for(self, crop: str, sido: str, sigungu: str) -> Optional[Window]:
        ws = self.windows.get(crop) or []
        zone = self._zone_of(sido)
        for level, region in (("sigungu", f"{sido} {sigungu}"), ("sido", sido), ("zone", zone), ("national", "")):
            if level != "national" and not region:
                continue
            for w in ws:
                if w.level != level:
                    continue
                if level == "national" or norm_region(w.region, level) == region:
                    return w
        return None

    def assess(self, crop: str, address: str) -> SpotCrop:
        sido, sigungu = region_key(address)
        if crop in self.crops_with_cultivation() and sido:
            hit = self.cultivation.get((crop, sido, sigungu))
            area = hit[0] if hit else 0.0
            grown = "grown" if area > self.min_area_ha else "not_grown"
            src = hit[2] if hit else next((v[2] for (c, _, _), v in self.cultivation.items() if c == crop), "")
            cult = (grown, area, src)
        else:
            cult = ("unknown", None, "")
        return SpotCrop(cultivation=cult[0], area_ha=cult[1], cultivation_source=cult[2], window=self.window_for(crop, sido, sigungu))

    def coverage_warnings(self, crops: set[str]) -> list[str]:
        out = []
        miss_c = sorted(crops - self.crops_with_cultivation())
        miss_w = sorted(crops - self.crops_with_calendar())
        if miss_c:
            out.append(f"재배현황 자료 없음({', '.join(miss_c)}) — 비재배지 판정을 하지 않았습니다.")
        if miss_w:
            out.append(f"재배 기간 자료 없음({', '.join(miss_w)}) — 재배 시기 판정을 하지 않았습니다.")
        return out


def norm_region(region: str, level: str) -> str:
    """기간 표의 region 표기를 판정 키 형식으로. sigungu는 '경기 수원시', sido는 '경기'."""
    if level == "sigungu":
        s, g = region_key(region)
        return f"{s} {g}"
    if level == "sido":
        return norm_sido(region)
    return (region or "").strip()


def load_default(min_area_ha: float | None = None) -> Phenology:
    from . import config

    return Phenology.load(
        config.CULTIVATION_CSV,
        config.CROP_CALENDAR_YAML,
        config.MIN_CULTIVATION_HA if min_area_ha is None else min_area_ha,
    )
