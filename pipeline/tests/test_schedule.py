from pipeline import schedule

HTML = """
<h2>생육과정(주요농작업)</h2><table class="tblSchedule "><thead></thead><tbody>
<tr><td colspan="36" class="empty"></td></tr>
<tr><td colspan="8" class="calTd bgBlue">발아기, 모기르기</td><td colspan="3" class="calTd bgBlue">아주심기</td>
<td colspan="11" class="calTd bgBlue">생육기</td><td>&nbsp;</td><td>&nbsp;</td><td colspan="12" class="calTd">월동</td></tr>
<tr><td colspan="36" class="empty"></td></tr>
<tr><td colspan="14">&nbsp;</td><td colspan="2" class="calTd bgBlue">수확</td><td colspan="20">&nbsp;</td></tr>
</tbody></table>
<h2>병충해 방제</h2><table class="tblSchedule"><tbody><tr><td colspan="36" class="calTd">탄저병 방제</td></tr></tbody></table>
"""


AUG_FIRST = HTML.replace("<thead></thead>", "<thead><tr>" + "".join(f"<th colspan='3'>{m}월</th>" for m in [8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7]) + "</tr></thead>")


def test_parse_table_counts_colspans_and_skips_blank_cells():
    t = schedule.parse_table(HTML)
    rows = t.rows
    assert [c.label for c in rows[0]] == ["발아기, 모기르기", "아주심기", "생육기", "월동"]
    assert (rows[0][1].start, rows[0][1].end) == (8, 10)   # 3월 하순 ~ 4월 중순
    assert (rows[1][0].start, rows[1][0].end) == (14, 15)  # 5월 하순 ~ 6월 상순
    assert len(rows) == 2  # 두 번째 표(병충해)는 읽지 않는다
    assert t.months == tuple(range(1, 13))  # thead 에 달이 없으면 1월 시작


def test_slot_dates_follow_table_month_order():
    t = schedule.parse_table(HTML)
    assert schedule.slot_date(t, 0) == "01-01" and schedule.slot_date(t, 8) == "03-21"
    assert schedule.slot_date(t, 5, end=True) == "02-28" and schedule.slot_date(t, 35, end=True) == "12-31"
    assert schedule.slot_label(t, 10) == "4월 중순"
    a = schedule.parse_table(AUG_FIRST)
    assert a.months[:3] == (8, 9, 10) and schedule.slot_date(a, 8) == "10-21" and schedule.slot_label(a, 15) == "1월 상순"


def test_derive_windows_prefers_transplant_over_nursery_and_pairs_with_next_harvest():
    ws = schedule.derive_windows(schedule.parse_table(HTML))
    assert len(ws) == 1 and ws[0]["start"] == "03-21" and ws[0]["end"] == "06-10"
    assert ws[0]["start_basis"].startswith("아주심기") and ws[0]["end_basis"].startswith("수확")
    # 8월 시작 표: 같은 칸이라도 달력 날짜는 해를 넘긴다(start > end)
    w = schedule.derive_windows(schedule.parse_table(AUG_FIRST))[0]
    assert (w["start"], w["end"]) == ("10-21", "01-10")
    assert schedule.derive_windows(schedule.parse_table("")) == []
