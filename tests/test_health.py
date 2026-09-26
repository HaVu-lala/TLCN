from fastapi.testclient import TestClient

from app.main import app


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
