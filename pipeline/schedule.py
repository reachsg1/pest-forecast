"""농사로 '작목별 농작업일정' 표 해석 — 생육단계·농작업이 1~12월 상·중·하순(36칸) 중 어디에 걸치는지 읽고,
'작물이 포장에 있는 기간' 초안(시작·끝 날짜)을 뽑는다. 호출·저장은 scripts/fetch_crop_schedules.py.

표 구조(API workScheduleEraInfoLst 의 htmlCn, 첫 <h2> '생육과정(주요농작업)' 아래 tblSchedule):
  <tr> 안에 <td colspan=N class="calTd ...">라벨</td> 과 빈 <td> 들이 36칸을 채운다. colspan 을 누적해 칸 위치를 센다.
칸 번호 i(0~35) → 월 = i//3+1, 순 = i%3 (0 상·1 중·2 하).
"""
from __future__ import annotations

import calendar
import re
from dataclasses import dataclass

SLOTS = 36
JAN_FIRST = list(range(1, 13))
# 시작 근거로 삼을 농작업(앞이 우선). 모기르기·파종(육묘)은 포장 밖이므로 정식·이앙이 있으면 그쪽을 쓴다
START_WORDS = ["정식", "아주심기", "이앙", "모내기", "씨뿌림", "파종", "발아", "출아"]
END_WORDS = ["수확"]


@dataclass(frozen=True)
class Cell:
    label: str
    start: int  # 칸 번호 0~35
    end: int    # 마지막 칸 번호(포함)


@dataclass(frozen=True)
class Table:
    months: tuple[int, ...]  # 칸 순서대로의 달(표가 1월에 시작하지 않을 수 있음 — 마늘·양파·보리는 8~9월 시작)
    rows: tuple[tuple[Cell, ...], ...]

    def month(self, i: int) -> int:
        return self.months[i // 3]


def parse_months(table_html: str) -> list[int]:
    head = re.search(r"<thead>(.*?)</thead>", table_html, re.S)
    found = [int(x) for x in re.findall(r"(\d{1,2})월", re.sub(r"<[^>]+>", " ", head.group(1) if head else ""))]
    return found if len(found) == 12 else JAN_FIRST


def parse_table(html: str) -> Table:
    """첫 번째 tblSchedule(생육과정)의 달 순서와 본문 라벨 칸들. 행마다 Cell 목록(빈 행은 뺀다)."""
    m = re.search(r'<table[^>]*class="tblSchedule[^"]*"[^>]*>(.*?)</table>', html, re.S)
    if not m:
        return Table(tuple(JAN_FIRST), ())
    body = re.search(r"<tbody>(.*?)</tbody>", m.group(1), re.S)
    rows: list[tuple[Cell, ...]] = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", body.group(1) if body else m.group(1), re.S):
        pos, cells = 0, []
        for attrs, inner in re.findall(r"<td([^>]*)>(.*?)</td>", tr, re.S):
            span = int((re.search(r'colspan="?(\d+)', attrs) or [None, "1"])[1])
            text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", inner).replace("&nbsp;", " ")).strip()
            if text and "calTd" in attrs:
                cells.append(Cell(text, pos, pos + span - 1))
            pos += span
        if cells:
            rows.append(tuple(cells))
    return Table(tuple(parse_months(m.group(1))), tuple(rows))


def slot_date(t: Table, i: int, *, end: bool = False) -> str:
    """칸 번호 → 'MM-DD'. 시작은 순의 첫날(1·11·21), 끝은 순의 마지막 날(10·20·말일)."""
    month, part = t.month(i), i % 3
    if end:
        day = [10, 20, calendar.monthrange(2025, month)[1]][part]
    else:
        day = [1, 11, 21][part]
    return f"{month:02d}-{day:02d}"


def slot_label(t: Table, i: int) -> str:
    return f"{t.month(i)}월 {'상중하'[i % 3]}순"


def _find(t: Table, words: list[str]) -> list[Cell]:
    for w in words:
        hit = [c for r in t.rows for c in r if w in c.label]
        if hit:
            return sorted(hit, key=lambda c: c.start)
    return []


def derive_windows(t: Table) -> list[dict]:
    """작기마다 하나씩: 우선순위 농작업 칸(정식·이앙·씨뿌림…)의 첫 칸부터, 다음 시작 칸 전까지 이어지는 '수확' 칸들(조생~만생) 중
    마지막 칸까지. 그 사이에 수확 칸이 없으면 표 앞쪽(해를 넘긴 뒤)의 수확 칸들을 쓴다. 같은 수확에 닿는 시작 칸은 가장 이른 것만 남긴다.
    달력 날짜는 표의 달 순서(thead)로 바꾸므로, 가을 파종 작물은 start > end 가 된다(crop_calendar 규칙과 같음)."""
    starts, ends = _find(t, START_WORDS), _find(t, END_WORDS)
    if not starts or not ends:
        return []
    out: dict[int, dict] = {}
    for k, s in enumerate(starts):
        nxt = next((x.start for x in starts[k + 1:] if x.start > s.end), None)
        run = [e for e in ends if e.start > s.end and (nxt is None or e.start < nxt)]
        if not run:  # 해를 넘겨 표 앞쪽에서 수확
            run = [e for e in ends if e.start < starts[0].start]
        if not run:
            continue
        e = max(run, key=lambda c: c.end)
        key = e.start
        if key in out:
            continue  # 같은 수확에 닿는 더 이른 시작 칸이 이미 있음
        out[key] = {
            "start": slot_date(t, s.start), "end": slot_date(t, e.end, end=True),
            "start_basis": f"{s.label} {slot_label(t, s.start)}~{slot_label(t, s.end)}",
            "end_basis": f"{e.label} {slot_label(t, e.start)}~{slot_label(t, e.end)}",
        }
    return list(out.values())
