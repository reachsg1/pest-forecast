"""API 키가 오류·로그 문자열에 남지 않는지."""
from pipeline.fetch.http import _redact


def test_redact_removes_keys_in_any_form():
    key = "Ab+c/d=="
    msg = f"GET url?apiKey={key}&x=1 / serviceKey=Ab%2Bc%2Fd%3D%3D / raw {key}"
    out = _redact(msg, {"serviceKey": key})
    assert key not in out
    assert "Ab%2Bc%2Fd%3D%3D" not in out
    assert "x=1" in out


def test_redact_masks_unknown_key_values_by_param_name():
    out = _redact("http://h/s?apiKey=zzz999&serviceCode=SVC53", {})
    assert "zzz999" not in out and "serviceCode=SVC53" in out
