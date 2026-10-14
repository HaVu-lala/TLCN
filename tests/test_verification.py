import httpx
import pytest
from fastapi.testclient import TestClient

from app.agent import AttackAgent, AttackProbe, VerificationAgent
from app.evaluation import evaluate_demo, metrics
from app.main import app
from app.schemas import Finding
from app.tools import WebTools


def test_sql_error_already_in_baseline_is_not_injection():
    assert not VerificationAgent().run([AttackProbe("basic_sqli", "http://localhost/demo", "q", "SQL syntax error", 500, "SQL syntax error", baseline_status=200)])


def test_sql_error_requires_a_successful_baseline():
    assert not VerificationAgent().run([AttackProbe("basic_sqli", "http://localhost/demo", "q", "SQL syntax error", 500, "", baseline_status=0)])
    assert VerificationAgent().run([AttackProbe("basic_sqli", "http://localhost/demo", "q", "SQL syntax error", 500, "normal results", baseline_status=200)])


@pytest.mark.parametrize("body,status,content_type", [
    ("<textarea><script>alert(1)</script></textarea>", 200, "text/html"),
    ("<script>alert(1)</script>", 403, "text/html"),
    ("<script>alert(1)</script>", 200, "application/json"),
    ("&lt;script&gt;alert(1)&lt;/script&gt;", 200, "text/html"),
])
def test_xss_requires_success_and_active_html_context(body, status, content_type):
    assert not VerificationAgent().run([AttackProbe("stored_xss", "http://localhost/demo/notes", "note", body, status, content_type=content_type)])


def test_stored_xss_reads_again_without_submitted_payload(monkeypatch):
    tools = WebTools("http://localhost/demo")
    tools.client.close()
    requests = []
    def handler(request):
        requests.append(request)
        return httpx.Response(200, text=request.url.params.get("note", ""), headers={"content-type": "text/html"})
    tools.client = httpx.Client(transport=httpx.MockTransport(handler))
    form = {"action": "http://localhost/demo/notes", "inputs": [{"name": "note"}]}
    probes = AttackAgent(tools).run([{"forms": [form]}], ["stored_xss"])
    assert len(requests) == 2
    assert not requests[1].url.query
    assert not VerificationAgent().run(probes)
    tools.client.close()


def test_different_objects_do_not_prove_bola():
    assert not VerificationAgent().run([AttackProbe("idor", "http://localhost/demo/object", "id", "Object B", 200, "Object A")])


def test_safe_fixture_encodes_and_authorizes():
    client = TestClient(app)
    marker = "<script>alert(1)</script>"
    assert marker not in client.get("/demo-safe", params={"q": marker}).text
    assert marker not in client.get("/demo-safe/notes", params={"note": marker}).text
    assert client.get("/demo-safe/object?id=1", headers={"X-Lab-User": "user-1"}).status_code == 200
    assert client.get("/demo-safe/object?id=1", headers={"X-Lab-User": "user-2"}).status_code == 403


def test_arbitrary_demo_path_has_no_ground_truth():
    assert not evaluate_demo("http://localhost/demo", [{"status": 200}], [])["ground_truth_available"]


def test_case_matching_requires_route_and_parameter():
    finding = Finding(category="Stored XSS", severity="high", url="http://localhost/demo", parameter="q", evidence="test", recommendation="fix")
    result = evaluate_demo("http://localhost/demo", [{"status": 200, "fixture_id": "sentinel-demo-v2"}], [finding])
    assert result["true_positive"] == 0
    assert result["false_negative"] == 4
    assert result["false_positive"] == 1
    assert not result["fpr_available"]


def test_negative_fixture_measures_fpr():
    result = evaluate_demo("http://localhost/demo-safe", [{"status": 200, "fixture_id": "sentinel-safe-v2"}], [])
    assert result["true_negative"] == 4
    assert result["false_positive_rate"] == 0
    assert metrics(2, 1, 2, 3)["false_positive_rate"] == 0.25


def test_cross_origin_redirect_blocked_before_request():
    tools = WebTools("http://localhost:8000/demo")
    tools.client.close()

    seen = []
    def handler(request):
        seen.append(str(request.url))
        return httpx.Response(302, headers={"location": "http://outside.example/"})
    tools.client = httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=True, event_hooks={"request": [tools._guard_request]})
    with pytest.raises(ValueError, match="outside the target origin"):
        tools.request("http://localhost:8000/demo")
    assert len(seen) == 1
    tools.client.close()


def test_crawler_skips_blocked_redirect_without_sending_it(monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "browser_scan_enabled", False)
    tools = WebTools("http://localhost:8000/demo")
    tools.client.close()
    seen = []
    def handler(request):
        seen.append(str(request.url))
        if request.url.path == "/demo":
            return httpx.Response(200, text='<a href="/webwolf">WebWolf</a>', headers={"content-type": "text/html"})
        return httpx.Response(302, headers={"location": "http://localhost:9090/"})
    tools.client = httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=True, event_hooks={"request": [tools._guard_request]})
    pages = tools.crawl()
    assert len(pages) == 2
    assert pages[1]["scope_blocked"]
    assert len(seen) == 2
    tools.client.close()


def test_planner_context_omits_secrets_and_validates_tests(monkeypatch):
    from app.agent import PlanningAgent
    from app.config import settings
    from app import reasoning
    monkeypatch.setattr(settings, "deepseek_api_key", "fake-test-key")
    def fake_post(url, **kwargs):
        import json
        content = json.dumps(kwargs["json"]["messages"])
        assert "private-value" not in content
        assert kwargs["json"]["max_tokens"] == settings.agent_max_tokens
        return httpx.Response(200, request=httpx.Request("POST", url), json={
            "choices": [{"message": {"content": '{"rationale":"try SQL","tests":["basic_sqli"]}'}}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}})
    monkeypatch.setattr(reasoning.httpx, "post", fake_post)
    planner = PlanningAgent("http://localhost/demo?secret=private-value")
    assert planner.run([{"url": "http://localhost/demo", "forms": [{"action": "http://localhost/demo", "inputs": [{"name": "q", "value": "private-value"}]}]}]) == ["basic_sqli"]
    assert planner.used_deepseek
    assert planner.llm_usage["total_tokens"] == 15


def test_markdown_export_escapes_active_evidence(monkeypatch, tmp_path):
    from app import main
    from app.repository import ScanRepository
    from app.schemas import ScanResult
    repository = ScanRepository(str(tmp_path / "scans.sqlite3"))
    repository.save(ScanResult(scan_id="export-test", target_url="http://localhost/demo", pages=[],
        findings=[Finding(category="Stored XSS", severity="high", url="http://localhost/demo/notes", parameter="note",
                          evidence="<script>alert(1)</script>", recommendation="Encode HTML")],
        agent_summary="Test export", used_deepseek=False, duration_ms=1, evaluation={}, test_timings_ms={"stored_xss": 0.5}))
    monkeypatch.setattr(main, "scan_repository", repository)
    response = TestClient(app).get("/api/scans/export-test/report.md")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/markdown")
    assert "<script>" not in response.text
    assert "&lt;script&gt;" in response.text
    assert "stored_xss: 0.5" in response.text
