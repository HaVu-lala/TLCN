import httpx
from fastapi.testclient import TestClient

from app.main import app, safe_login_failures
from app.passive import passive_findings
from app.auth_checks import check_authentication, find_login_forms
from app.evaluation import evaluate_extended
from app.tools import WebTools


def _page_from(client: TestClient, path: str, fixture_id: str) -> dict:
    response = client.get(path)
    return {"url": f"http://testserver{path}", "status": response.status_code,
            "headers": dict(response.headers), "body": response.text,
            "content_type": response.headers.get("content-type", ""), "fixture_id": fixture_id,
            "forms": [{"action": f"http://testserver{path}/login", "method": "POST",
                       "inputs": [{"name": "username", "type": "text"}, {"name": "password", "type": "password"}]}]}


def test_passive_flags_misconfig_version_and_cookie_on_demo():
    client = TestClient(app)
    findings = passive_findings([_page_from(client, "/demo", "sentinel-demo-v2")], "http://testserver/demo")
    categories = {f.category for f in findings}
    assert "Security Misconfiguration" in categories
    assert "Software Supply Chain Exposure" in categories
    assert "Cryptographic Failures" in categories


def test_passive_quiet_on_hardened_safe_demo():
    client = TestClient(app)
    findings = passive_findings([_page_from(client, "/demo-safe", "sentinel-safe-v2")], "http://testserver/demo-safe")
    assert findings == []


def _parse_body(request) -> dict:
    from urllib.parse import parse_qs
    return {k: v[-1] for k, v in parse_qs(request.content.decode()).items()}


def _mock_tools(target: str, handler) -> WebTools:
    tools = WebTools(target)
    tools.client.close()
    tools.client = httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=True)
    return tools


def test_auth_check_finds_default_credentials_on_demo():
    def handler(request):
        creds = _parse_body(request)
        if creds.get("username") == "admin" and creds.get("password") == "admin":
            return httpx.Response(200, json={"status": "ok", "token": "t"})
        return httpx.Response(200, json={"status": "invalid"})
    pages = [{"forms": [{"action": "http://localhost/demo/login", "method": "POST",
                         "inputs": [{"name": "username", "type": "text"}, {"name": "password", "type": "password"}]}]}]
    assert find_login_forms(pages)
    tools = _mock_tools("http://localhost/demo", handler)
    findings = check_authentication(tools, pages)
    tools.client.close()
    assert any(f.category == "Authentication Failures" and "Default credentials" in f.evidence for f in findings)


def test_auth_check_quiet_on_hardened_login():
    state = {"failures": 0}

    def handler(request):
        creds = _parse_body(request)
        if state["failures"] >= 3:
            return httpx.Response(429, json={"status": "locked", "detail": "too many attempts"})
        if creds.get("username") == "legit-user" and creds.get("password") == "S3cure!pass":
            return httpx.Response(200, json={"status": "ok"})
        state["failures"] += 1
        return httpx.Response(401, json={"status": "invalid"})
    pages = [{"forms": [{"action": "http://localhost/demo-safe/login", "method": "POST",
                         "inputs": [{"name": "username", "type": "text"}, {"name": "password", "type": "password"}]}]}]
    tools = _mock_tools("http://localhost/demo-safe", handler)
    findings = check_authentication(tools, pages)
    tools.client.close()
    assert findings == []


def test_evaluate_extended_scores_positive_and_negative():
    from app.schemas import Finding
    pages_pos = [{"url": "http://testserver/demo", "status": 200, "fixture_id": "sentinel-demo-v2"}]
    findings = [
        Finding(category="Security Misconfiguration", severity="medium", url="http://testserver/demo", parameter=None, evidence="e", recommendation="r"),
        Finding(category="Software Supply Chain Exposure", severity="low", url="http://testserver/demo", parameter=None, evidence="e", recommendation="r"),
        Finding(category="Cryptographic Failures", severity="medium", url="http://testserver/demo", parameter=None, evidence="e", recommendation="r"),
        Finding(category="Authentication Failures", severity="high", url="http://testserver/demo/login", parameter="password", evidence="e", recommendation="r"),
    ]
    result = evaluate_extended("http://testserver/demo", pages_pos, findings)
    assert result["ground_truth_available"]
    assert result["true_positive"] == 4
    assert result["recall"] == 1.0

    pages_neg = [{"url": "http://testserver/demo-safe", "status": 200, "fixture_id": "sentinel-safe-v2"}]
    negative = evaluate_extended("http://testserver/demo-safe", pages_neg, [])
    assert negative["true_negative"] == 4
    assert negative["false_positive_rate"] == 0.0


def test_extended_lab_checks_juice_shop_a07_and_ftp():
    def handler(request):
        path = request.url.path
        if path == "/rest/user/login":
            return httpx.Response(401, json={"error": "Invalid email or password."})
        if path == "/ftp":
            return httpx.Response(200, text="<html><h1>Index of /ftp</h1><a href='acquisitions.md'>acquisitions.md</a></html>",
                                  headers={"content-type": "text/html"})
        return httpx.Response(200, text="<title>OWASP Juice Shop</title>", headers={"content-type": "text/html"})
    from app.labs import extended_lab_checks
    tools = _mock_tools("http://juice-shop:3000", handler)
    findings = extended_lab_checks(tools, [{"lab": "juice-shop"}])
    tools.client.close()
    categories = {f.category for f in findings}
    assert "Authentication Failures" in categories
    assert "Security Misconfiguration" in categories


def test_extended_lab_checks_quiet_when_login_not_rejecting():
    # A login endpoint that returns 200 for wrong creds is not treated as an auth weakness,
    # and a missing /ftp must not be reported.
    def handler(request):
        if request.url.path == "/ftp":
            return httpx.Response(404, text="not found")
        return httpx.Response(200, json={"data": []})
    from app.labs import extended_lab_checks
    tools = _mock_tools("http://juice-shop:3000", handler)
    findings = extended_lab_checks(tools, [{"lab": "juice-shop"}])
    tools.client.close()
    assert findings == []
