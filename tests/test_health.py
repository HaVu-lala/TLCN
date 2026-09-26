from fastapi.testclient import TestClient

from app.main import app
from app.schemas import ScanRequest, ScanResult


def test_health():
    response = TestClient(app).get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_missing_report_is_not_found():
    response = TestClient(app).get("/api/scans/missing/report")
    assert response.status_code == 404


def test_demo_object_changes_by_identifier():
    client = TestClient(app)
    first = client.get("/demo/object?id=1")
    second = client.get("/demo/object?id=2")
    assert first.status_code == 200
    assert second.status_code == 200
    assert first.text != second.text


def test_demo_notes_persist_controlled_marker():
    client = TestClient(app)
    marker = "<script>alert(1)</script>"
    response = client.get("/demo/notes", params={"note": marker})
    assert response.status_code == 200
    assert marker in response.text


def test_scan_request_accepts_session_headers_without_exposing_them_in_result():
    request = ScanRequest(
        target_url="http://localhost:8000/demo",
        authorized=True,
        session_headers={"Cookie": "lab-session=demo"},
    )
    result = ScanResult(
        scan_id="session-test",
        target_url=str(request.target_url),
        pages=[],
        findings=[],
        agent_summary="done",
        used_deepseek=False,
        duration_ms=0,
        evaluation={"ground_truth_available": False},
    )
    assert request.session_headers["Cookie"] == "lab-session=demo"
    assert "session_headers" not in result.model_dump()
    assert "lab-session=demo" not in result.model_dump_json()
