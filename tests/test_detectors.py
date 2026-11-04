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


def test_browser_xss_returns_empty_when_disabled(monkeypatch):
    from app.config import settings
    from app.browser_xss import browser_reflected_xss
    monkeypatch.setattr(settings, "browser_scan_enabled", False)
    assert browser_reflected_xss(None, [{"endpoints": [{"url": "http://x/a", "method": "GET", "parameters": ["q"]}]}]) == []


def test_browser_xss_returns_empty_when_no_get_params(monkeypatch):
    from app.config import settings
    from app.browser_xss import browser_reflected_xss
    monkeypatch.setattr(settings, "browser_scan_enabled", True)
    # không có GET param -> không gọi trình duyệt, trả rỗng
    assert browser_reflected_xss(None, [{"endpoints": [{"url": "http://x/a", "method": "POST", "parameters": ["q"]}]}]) == []


def test_access_control_flags_admin_endpoint_returning_data():
    import httpx
    from app.access_control import check_access_control
    def handler(r):
        if r.url.path == "/api/admin/dashboard":
            return httpx.Response(200, json={"stats": {"totalUsers": 18, "totalOrders": 38}}, headers={"content-type": "application/json"})
        return httpx.Response(401, json={"error": "Unauthorized"}, headers={"content-type": "application/json"})
    tools = _mock_tools("http://localhost:8081/", handler)
    findings = check_access_control(tools, [])
    tools.client.close()
    assert [f.category for f in findings] == ["Broken Access Control"]
    assert "/api/admin/dashboard" in findings[0].url


def test_open_redirect_flags_external_location():
    from app.open_redirect import check_open_redirect, PAYLOAD_HOST
    # Ung dung ngay tho: tra ve 302 voi Location bang dung URL nguoi dung cung cap.
    def handler(r):
        nxt = r.url.params.get("next", "")
        if nxt:
            return httpx.Response(302, headers={"location": nxt})
        return httpx.Response(200, text="ok")
    tools = _mock_tools("http://localhost/app", handler)
    pages = [{"endpoints": [{"url": "http://localhost/app/login", "method": "GET", "parameters": ["next"]}]}]
    findings = check_open_redirect(tools, pages)
    tools.client.close()
    assert [f.category for f in findings] == ["Open Redirect"]
    assert PAYLOAD_HOST in findings[0].evidence


def test_open_redirect_quiet_when_internal_only():
    from app.open_redirect import check_open_redirect
    # Ung dung an toan: bo qua dau vao, chi chuyen huong noi bo.
    def handler(r):
        return httpx.Response(302, headers={"location": "/dashboard"})
    tools = _mock_tools("http://localhost/app", handler)
    pages = [{"endpoints": [{"url": "http://localhost/app/login", "method": "GET", "parameters": ["next"]}]}]
    findings = check_open_redirect(tools, pages)
    tools.client.close()
    assert findings == []


def test_csrf_flags_post_form_without_token():
    from app.csrf import check_csrf
    pages = [{"forms": [{"action": "http://localhost/app/profile", "method": "POST",
                         "inputs": [{"name": "email", "type": "text"}]}]}]
    findings = check_csrf(None, pages)
    assert [f.category for f in findings] == ["Potential CSRF"]
    assert findings[0].severity == "low"


def test_csrf_quiet_when_token_present_or_get():
    from app.csrf import check_csrf
    pages = [
        {"forms": [{"action": "http://localhost/app/a", "method": "POST",
                    "inputs": [{"name": "csrf_token", "type": "hidden"}, {"name": "email"}]}]},
        {"forms": [{"action": "http://localhost/app/b", "method": "GET", "inputs": [{"name": "q"}]}]},
    ]
    assert check_csrf(None, pages) == []


def test_path_traversal_flags_passwd_disclosure():
    from app.path_traversal import check_path_traversal
    def handler(r):
        f = r.url.params.get("file", "")
        if ".." in f or "etc/passwd" in f or "%2f" in f.lower():
            return httpx.Response(200, text="root:x:0:0:root:/root:/bin/bash")
        return httpx.Response(200, text="normal content")
    tools = _mock_tools("http://localhost/app", handler)
    pages = [{"endpoints": [{"url": "http://localhost/app/view", "method": "GET", "parameters": ["file"]}]}]
    findings = check_path_traversal(tools, pages)
    tools.client.close()
    assert [f.category for f in findings] == ["Path Traversal"]


def test_path_traversal_quiet_when_no_disclosure():
    from app.path_traversal import check_path_traversal
    def handler(r):
        return httpx.Response(200, text="normal content only")
    tools = _mock_tools("http://localhost/app", handler)
    pages = [{"endpoints": [{"url": "http://localhost/app/view", "method": "GET", "parameters": ["file"]}]}]
    findings = check_path_traversal(tools, pages)
    tools.client.close()
    assert findings == []


def test_xxe_flags_external_entity_disclosure():
    from app.xxe import check_xxe
    def handler(r):
        body = r.content.decode(errors="ignore")
        if "SYSTEM" in body and "etc/passwd" in body:
            return httpx.Response(200, text="parsed: root:x:0:0:root:/root:/bin/bash")
        return httpx.Response(200, text="ok benign")
    tools = _mock_tools("http://localhost/app", handler)
    pages = [{"endpoints": [{"url": "http://localhost/app/xml", "method": "POST", "accepts_xml": True}]}]
    findings = check_xxe(tools, pages)
    tools.client.close()
    assert [f.category for f in findings] == ["XXE"]


def test_xxe_quiet_when_entity_not_processed():
    from app.xxe import check_xxe
    def handler(r):
        return httpx.Response(200, text="ok benign; no entity expansion")
    tools = _mock_tools("http://localhost/app", handler)
    pages = [{"endpoints": [{"url": "http://localhost/app/xml", "method": "POST", "accepts_xml": True}]}]
    findings = check_xxe(tools, pages)
    tools.client.close()
    assert findings == []


def test_access_control_quiet_when_admin_denied_or_html():
    import httpx
    from app.access_control import check_access_control
    # 401 for admin APIs, and SPA HTML 200 for everything else -> no finding.
    def handler(r):
        if "admin" in r.url.path:
            return httpx.Response(401, json={"error": "Unauthorized"}, headers={"content-type": "application/json"})
        return httpx.Response(200, text="<html>app shell</html>", headers={"content-type": "text/html"})
    tools = _mock_tools("http://localhost:3000/", handler)
    findings = check_access_control(tools, [])
    tools.client.close()
    assert findings == []


def test_detector_registry_runs_registered_and_isolates_failures():
    # The registry is the single extension point: a registered detector runs, and
    # one that raises is skipped without aborting the rest of the battery.
    from app.detectors import DetectorContext, run_all, STANDING_DETECTORS
    from app.schemas import Finding

    def ok(ctx):
        return [Finding(category="Demo Registry Check", severity="low", url="http://x",
                        parameter=None, evidence="e", recommendation="r")]

    def boom(ctx):
        raise RuntimeError("detector crashed")

    added = [("demo-ok", ok), ("demo-boom", boom)]
    STANDING_DETECTORS.extend(added)
    try:
        categories = [f.category for f in run_all(DetectorContext(tools=None, pages=[]))]
    finally:
        for item in added:
            STANDING_DETECTORS.remove(item)
    assert "Demo Registry Check" in categories  # registered detector ran; boom did not abort it
