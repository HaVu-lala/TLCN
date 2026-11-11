import importlib
from types import SimpleNamespace

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import app, safe_login_failures
from app.schemas import Finding, dedupe_findings
from app.passive import passive_findings
from app.auth_checks import check_authentication, find_login_forms
from app.evaluation import _under_route, evaluate_extended, evaluate_lab
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


LOGIN_PAGES = [{"forms": [{"action": "http://localhost/demo/login", "method": "POST",
                           "inputs": [{"name": "username", "type": "text"}, {"name": "password", "type": "password"}]}]}]


def _lockout_findings(statuses):
    remaining = iter(statuses)
    tools = _mock_tools("http://localhost/demo", lambda request: httpx.Response(next(remaining), text="x"))
    findings = check_authentication(tools, LOGIN_PAGES)
    tools.client.close()
    return [f for f in findings if "lockout" in f.evidence]


@pytest.mark.parametrize("status", [500, 503, 404, 405])
def test_auth_lockout_not_claimed_when_login_never_processed(status):
    assert _lockout_findings([status] * 13) == []


def test_auth_lockout_not_claimed_when_one_attempt_is_a_server_error():
    assert _lockout_findings([401] * 12 + [500]) == []


def test_auth_lockout_still_reported_for_rejected_logins():
    assert len(_lockout_findings([401] * 13)) == 1


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


def test_open_redirect_accepts_explicit_port_in_location():
    from app.open_redirect import check_open_redirect, PAYLOAD_HOST

    def handler(request):
        return httpx.Response(302, headers={"location": f"https://{PAYLOAD_HOST}:443/evil"})
    pages = [{"endpoints": [{"url": "http://localhost/go", "parameters": ["next"]}]}]
    tools = _mock_tools("http://localhost/", handler)
    findings = check_open_redirect(tools, pages)
    tools.client.close()
    assert len(findings) == 1


def test_open_redirect_rejects_payload_host_as_userinfo():
    from app.open_redirect import check_open_redirect, PAYLOAD_HOST

    def handler(request):
        return httpx.Response(302, headers={"location": f"https://{PAYLOAD_HOST}@localhost/evil"})
    pages = [{"endpoints": [{"url": "http://localhost/go", "parameters": ["next"]}]}]
    tools = _mock_tools("http://localhost/", handler)
    findings = check_open_redirect(tools, pages)
    tools.client.close()
    assert findings == []


def test_open_redirect_probes_post_when_get_shares_the_url():
    from app.open_redirect import check_open_redirect, PAYLOAD_HOST

    def handler(request):
        if request.method == "POST":
            return httpx.Response(302, headers={"location": f"https://{PAYLOAD_HOST}/evil"})
        return httpx.Response(200, text="ok")
    pages = [{"endpoints": [{"url": "http://localhost/go", "parameters": ["next"]}],
              "forms": [{"action": "http://localhost/go", "method": "POST", "inputs": [{"name": "next"}]}]}]
    tools = _mock_tools("http://localhost/", handler)
    findings = check_open_redirect(tools, pages)
    tools.client.close()
    assert len(findings) == 1


def test_path_traversal_probes_post_when_get_shares_the_url():
    from app.path_traversal import check_path_traversal

    def handler(request):
        if request.method == "POST" and b"sentinel-benign" not in request.content:
            return httpx.Response(200, text="root:x:0:0:root:/root:/bin/bash")
        return httpx.Response(200, text="ok")
    pages = [{"endpoints": [{"url": "http://localhost/f", "parameters": ["file"]}],
              "forms": [{"action": "http://localhost/f", "method": "POST", "inputs": [{"name": "file"}]}]}]
    tools = _mock_tools("http://localhost/", handler)
    findings = check_path_traversal(tools, pages)
    tools.client.close()
    assert len(findings) == 1


def _finding(url, category, parameter=None):
    return SimpleNamespace(url=url, category=category, parameter=parameter)


def _lab_outcomes(findings):
    result = evaluate_lab("http://localhost:3000", [{"lab": "juice-shop"}], findings)
    return result, {s["id"]: s["outcome"] for s in result["scenarios"]}


def test_evaluate_lab_ignores_sibling_route_sharing_prefix():
    finding = _finding("http://localhost:3000/ftp-unrelated", "Security Misconfiguration")
    result, outcomes = _lab_outcomes([finding])
    assert outcomes["juice-shop-a02-01"] == "FN"
    assert result["unmatched_findings"] == 1


def test_evaluate_lab_accepts_route_itself_and_children():
    for url in ("http://localhost:3000/ftp", "http://localhost:3000/ftp/", "http://localhost:3000/ftp/legal.md"):
        _, outcomes = _lab_outcomes([_finding(url, "Security Misconfiguration")])
        assert outcomes["juice-shop-a02-01"] == "TP"


def test_evaluate_lab_matches_spa_hash_route():
    for url in ("http://localhost:3000/#/search", "http://localhost:3000/#/search?q=x"):
        _, outcomes = _lab_outcomes([_finding(url, "DOM XSS", "q")])
        assert outcomes["juice-shop-xss-01"] == "TP"
    _, outcomes = _lab_outcomes([_finding("http://localhost:3000/#/searching", "DOM XSS", "q")])
    assert outcomes["juice-shop-xss-01"] == "FN"


def test_evaluate_extended_does_not_credit_sibling_fixture():
    pages = [{"fixture_id": "sentinel-demo-v2", "status": 200}]
    finding = _finding("http://testserver/demo-safe", "Security Misconfiguration")
    result = evaluate_extended("http://testserver/demo", pages, [finding])
    outcome = {s["category"]: s["outcome"] for s in result["scenarios"]}
    assert outcome["Security Misconfiguration"] == "FN"
    assert result["unmatched_findings"] == 1


@pytest.mark.parametrize("module, param", [("app.open_redirect", "next"), ("app.path_traversal", "file")])
def test_method_variants_do_not_push_other_urls_past_the_cap(module, param):
    candidates = importlib.import_module(module)._candidates
    pages = [{"endpoints": [{"url": f"http://localhost/p{i}", "parameters": [param]}],
              "forms": [{"action": f"http://localhost/p{i}", "method": "POST", "inputs": [{"name": param}]}]}
             for i in range(6)]
    targets = candidates(pages)
    assert len(targets) == 10
    assert {t[0] for t in targets} == {f"http://localhost/p{i}" for i in range(6)}
    assert targets[0][:3] == ("http://localhost/p0", param, "GET")


def test_open_redirect_reports_once_when_get_and_post_are_vulnerable():
    from app.open_redirect import check_open_redirect, PAYLOAD_HOST

    def handler(request):
        return httpx.Response(302, headers={"location": f"https://{PAYLOAD_HOST}/evil"})
    pages = [{"endpoints": [{"url": "http://localhost/go", "parameters": ["next"]}],
              "forms": [{"action": "http://localhost/go", "method": "POST", "inputs": [{"name": "next"}]}]}]
    tools = _mock_tools("http://localhost/", handler)
    findings = check_open_redirect(tools, pages)
    tools.client.close()
    assert len(findings) == 1


def test_under_route_handles_root():
    assert all(_under_route(path, "/") for path in ("", "/", "/any/page"))


@pytest.mark.parametrize("module, param", [("app.open_redirect", "next"), ("app.path_traversal", "file")])
def test_late_method_variant_keeps_discovery_order_at_the_cap(module, param):
    candidates = importlib.import_module(module)._candidates
    pages = [{"endpoints": [{"url": f"http://localhost/p{i}", "parameters": [param]} for i in range(11)],
              "forms": [{"action": "http://localhost/p0", "method": "POST", "inputs": [{"name": param}]}]}]
    assert [t[0] for t in candidates(pages)] == [f"http://localhost/p{i}" for i in range(10)]


def _lockout_findings_for(responses):
    remaining = iter(responses)

    def handler(request):
        status, body = next(remaining)
        return httpx.Response(status, text=body)
    tools = _mock_tools("http://localhost/demo", handler)
    findings = check_authentication(tools, LOGIN_PAGES)
    tools.client.close()
    return [f for f in findings if "lockout" in f.evidence]


@pytest.mark.parametrize("status", [400, 403])
@pytest.mark.parametrize("body", ["Invalid password", "Incorrect username or password",
                                  "Mật khẩu không đúng", "Sai mật khẩu"])
def test_auth_lockout_reported_when_400_403_rejects_credentials(status, body):
    assert len(_lockout_findings_for([(status, body)] * 13)) == 1


@pytest.mark.parametrize("status", [400, 403])
@pytest.mark.parametrize("body", ["", "Forbidden", "403 Forbidden: invalid request", "Invalid CSRF token",
                                  "Request blocked by WAF", "Please complete the captcha",
                                  "Invalid password. CSRF token expired"])
def test_auth_lockout_not_claimed_when_400_403_is_not_a_rejection(status, body):
    assert _lockout_findings_for([(status, body)] * 13) == []


def test_auth_lockout_not_claimed_when_one_attempt_is_ambiguous():
    assert _lockout_findings_for([(401, "x")] * 12 + [(400, "Bad request")]) == []


def test_auth_lockout_not_claimed_when_burst_turns_forbidden():
    responses = [(401, "Invalid password")] * 11 + [(403, "Invalid password")] * 2
    assert _lockout_findings_for(responses) == []


def test_auth_lockout_not_claimed_when_forbidden_starts_after_default_credentials():
    responses = [(401, "Invalid password")] * 4 + [(403, "Invalid password")] * 9
    assert _lockout_findings_for(responses) == []


@pytest.mark.parametrize("limited", [(403, "Invalid password"), (429, "x")])
def test_auth_lockout_not_claimed_when_limiter_recovers_after_default_credentials(limited):
    responses = [(401, "Invalid password")] + [limited] * 3 + [(401, "Invalid password")] * 9
    assert _lockout_findings_for(responses) == []


def test_auth_lockout_evidence_counts_only_failed_login_burst():
    findings = _lockout_findings_for([(401, "Invalid password")] * 13)
    assert "10 consecutive failed logins" in findings[0].evidence
    assert "[401, 401, 401, 401, 401, 401, 401, 401, 401, 401]" in findings[0].evidence


@pytest.mark.parametrize("status", [200, 401])
@pytest.mark.parametrize("body", ["Please complete the captcha", "Invalid CSRF token", "CSRF token missing",
                                  '{"error": "CSRF verification failed"}', "<p>Invalid <b>CSRF</b> token</p>",
                                  "<p>Vui lòng nhập captcha</p>"])
def test_auth_lockout_not_claimed_when_challenge_blocks_login(status, body):
    assert _lockout_findings_for([(status, body)] * 13) == []


def test_auth_lockout_not_claimed_when_one_attempt_hits_a_challenge():
    responses = [(200, "Invalid password")] * 12 + [(200, "Please complete the captcha")]
    assert _lockout_findings_for(responses) == []


HIDDEN_ONLY_PAGES = [
    '<form><input type="hidden" name="csrf_token" value="abc"></form><p>Invalid password</p>',
    '<form><input type="hidden" name="note" value="invalid csrf"></form><p>Invalid password</p>',
    '<div class="g-recaptcha"></div><p>Invalid password</p>',
    '<script>alert("complete the captcha")</script><p>Invalid password</p>',
    '<noscript>Enable JavaScript to complete the captcha</noscript><p>Invalid password</p>',
    '<!-- complete the captcha --><p>Invalid password</p>',
]


@pytest.mark.parametrize("status", [200, 400, 403])
@pytest.mark.parametrize("body", HIDDEN_ONLY_PAGES)
def test_auth_lockout_reported_when_challenge_is_only_in_markup(status, body):
    assert len(_lockout_findings_for([(status, body)] * 13)) == 1


def _default_credential_findings(trial_response):
    def handler(request):
        if _parse_body(request).get("username") == "admin":
            return trial_response()
        return httpx.Response(401, text="Invalid password")
    tools = _mock_tools("http://localhost/demo", handler)
    findings = check_authentication(tools, LOGIN_PAGES)
    tools.client.close()
    return [f for f in findings if "Default credentials" in f.evidence]


def test_default_credentials_not_claimed_when_cookie_comes_with_challenge():
    trial = lambda: httpx.Response(200, text="Please complete the captcha", headers={"set-cookie": "session=abc"})
    assert _default_credential_findings(trial) == []


def test_default_credentials_still_reported_when_login_sets_cookie():
    trial = lambda: httpx.Response(200, text="<p>Hello</p>", headers={"set-cookie": "session=abc"})
    assert len(_default_credential_findings(trial)) == 1


def test_auth_lockout_reported_when_lock_word_is_only_in_script():
    page = "<script>const accountLocked = false;</script><p>Invalid password</p>"
    assert len(_lockout_findings_for([(401, page)] * 13)) == 1


@pytest.mark.parametrize("body", ["<p>Account locked</p>", '{"status": "locked"}'])
def test_auth_lockout_not_claimed_when_lock_message_is_visible(body):
    assert _lockout_findings_for([(401, "Invalid password")] * 11 + [(401, body)] * 2) == []


def test_auth_lockout_not_claimed_when_request_fails_validation():
    body = '{"detail":[{"type":"missing","loc":["body","email"],"msg":"Field required"}]}'
    assert _lockout_findings_for([(422, body)] * 13) == []


def test_auth_lockout_reported_when_422_rejects_credentials():
    assert len(_lockout_findings_for([(422, "Invalid password")] * 13)) == 1


@pytest.mark.parametrize("category", ["SQL Injection", "Potential SQL Injection"])
def test_evaluate_lab_accepts_either_sqli_oracle_on_juice_shop(category):
    finding = _finding("http://localhost:3000/rest/products/search?q=%27", category, "q")
    _, outcomes = _lab_outcomes([finding])
    assert outcomes["juice-shop-sqli-01"] == "TP"


def test_evaluate_lab_rejects_other_category_on_sqli_route():
    finding = _finding("http://localhost:3000/rest/products/search", "Reflected XSS", "q")
    _, outcomes = _lab_outcomes([finding])
    assert outcomes["juice-shop-sqli-01"] == "FN"


def _xss(url, parameter="q", severity="medium", category="Reflected XSS"):
    return Finding(category=category, severity=severity, url=url, parameter=parameter, evidence="e", recommendation="r")


def test_dedupe_collapses_per_probe_payload_urls():
    findings = [_xss(f"http://localhost/search?q=marker{i}") for i in range(11)]
    assert len(dedupe_findings(findings)) == 1


def test_dedupe_prefers_highest_severity():
    findings = [_xss("http://localhost/search?q=marker"), _xss("http://localhost/search", severity="high"),
                _xss("http://localhost/search?q=other")]
    assert [f.severity for f in dedupe_findings(findings)] == ["high"]


def test_dedupe_keeps_distinct_vulnerable_points():
    findings = [_xss("http://localhost/search?q=a"), _xss("http://localhost/ebook?file=a", "file"),
                _xss("http://localhost/search?q=a", "name"), _xss("http://localhost/search?q=a", category="Stored XSS"),
                _xss("http://localhost/search?page=2&q=a"), _xss("http://localhost/#/search", "q"),
                _xss("http://localhost/#/other", "q")]
    assert len(dedupe_findings(findings)) == 7


def test_dedupe_keeps_objects_when_finding_has_no_parameter():
    findings = [_xss("http://localhost/object?id=1", None), _xss("http://localhost/object?id=2", None)]
    assert len(dedupe_findings(findings)) == 2


def test_toolbox_keeps_highest_severity_across_records():
    from app.toolbox import ToolBox
    toolbox = ToolBox.__new__(ToolBox)
    toolbox.findings = []
    toolbox._record([_xss("http://localhost/search?q=a")])
    toolbox._record([_xss("http://localhost/search?q=b", severity="high")])
    assert [f["severity"] for f in toolbox.generate_report()["findings"]] == ["high"]


def test_dedupe_tie_keeps_later_lab_pinned_evidence():
    generic = Finding(category="Authentication Failures", severity="medium", url="http://localhost/login",
                      parameter="password", evidence="generic", recommendation="r")
    pinned = generic.model_copy(update={"evidence": "lab-pinned"})
    assert [f.evidence for f in dedupe_findings([generic, pinned])] == ["lab-pinned"]
