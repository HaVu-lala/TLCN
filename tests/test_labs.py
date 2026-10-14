import httpx
import pytest

from app.agent import AttackProbe, VerificationAgent
from app.config import settings
from app.labs import check_lab
from app.tools import WebTools


def lab_tools(monkeypatch, url, handler):
    monkeypatch.setattr(settings, "browser_scan_enabled", False)
    tools = WebTools(url)
    tools.client.close()
    tools.client = httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=True)
    return tools


def test_juice_shop_crawl_and_sql_error_difference(monkeypatch):
    def handler(request):
        if request.url.path == "/":
            return httpx.Response(200, text="<title>OWASP Juice Shop</title>", headers={"content-type": "text/html"})
        if request.url.params.get("q") == "'":
            return httpx.Response(500, text="SequelizeDatabaseError: SQLITE_ERROR")
        return httpx.Response(200, json={"data": []})
    tools = lab_tools(monkeypatch, "http://juice-shop:3000", handler)
    findings = check_lab(tools, tools.crawl(), ["basic_sqli"])
    assert len(findings) == 1
    assert findings[0].parameter == "q"


def test_existing_database_error_does_not_confirm_injection(monkeypatch):
    tools = lab_tools(monkeypatch, "http://juice-shop:3000", lambda r: httpx.Response(500, text="SQLITE_ERROR"))
    assert check_lab(tools, [{"lab": "juice-shop"}], ["basic_sqli"]) == []


def test_webgoat_posts_all_required_parameters_and_verifies_oracle(monkeypatch):
    def handler(request):
        if request.url.path.endswith("start.mvc"):
            return httpx.Response(200, text="WebGoat", headers={"content-type": "text/html"})
        assert request.method == "POST"
        assert b"auth_tan=" in request.content
        solved = b"OR" in request.content
        return httpx.Response(200, json={"lessonCompleted": solved, "output": "<table></table>" if solved else ""})
    tools = lab_tools(monkeypatch, "http://webgoat:8080/WebGoat", handler)
    findings = check_lab(tools, tools.crawl(), ["basic_sqli"])
    assert [f.category for f in findings] == ["SQL Injection"]


def test_webgoat_login_redirect_is_reported(monkeypatch):
    def handler(request):
        if request.url.path.endswith("login"):
            return httpx.Response(200, text="login")
        return httpx.Response(302, headers={"location": "/WebGoat/login"})
    tools = lab_tools(monkeypatch, "http://webgoat:8080/WebGoat", handler)
    with pytest.raises(ValueError, match="requires a valid lab login"):
        tools.crawl()


def test_json_reflection_is_not_xss():
    probe = AttackProbe("reflected_xss", "http://localhost", "q", '<script>alert(1)</script>', 200, content_type="application/json")
    assert VerificationAgent().run([probe]) == []


def test_juice_shop_boolean_sql_injection_without_error(monkeypatch):
    def handler(request):
        count = 2 if "1=1" in request.url.params.get("q", "") else 0
        return httpx.Response(200, json={"data": [{"id": i} for i in range(count)]})
    tools = lab_tools(monkeypatch, "http://juice-shop:3000", handler)
    assert [f.category for f in check_lab(tools, [{"lab": "juice-shop"}], ["basic_sqli"])] == ["SQL Injection"]


def test_crawler_does_not_follow_logout(monkeypatch):
    def handler(request):
        assert not request.url.path.endswith("logout")
        return httpx.Response(200, text='<a href="/WebGoat/logout">Logout</a>', headers={"content-type": "text/html"})
    tools = lab_tools(monkeypatch, "http://webgoat:8080/WebGoat", handler)
    assert len(tools.crawl()) == 1


def test_large_json_product_response_remains_parseable(monkeypatch):
    import json
    products = [{"id": i, "description": "x" * 500} for i in range(40)]
    tools = lab_tools(monkeypatch, "http://juice-shop:3000", lambda r: httpx.Response(200, json={"data": products}))
    result = tools.request("http://juice-shop:3000/rest/products/search")
    assert len(json.loads(result["body"])["data"]) == 40


def test_network_failure_returns_failed_observation(monkeypatch):
    def handler(request):
        raise httpx.ConnectError("unreachable", request=request)
    tools = lab_tools(monkeypatch, "http://localhost:3000", handler)
    assert tools.request("http://localhost:3000/rest/products/search")["status"] == 0


def test_webgoat_crawl_advertises_oracle_backed_lesson_endpoints(monkeypatch):
    def handler(request):
        return httpx.Response(200, text="WebGoat", headers={"content-type": "text/html"})
    tools = lab_tools(monkeypatch, "http://webgoat:8080/WebGoat", handler)
    endpoints = {e["url"].rsplit("/WebGoat/", 1)[-1] for page in tools.crawl() for e in page.get("endpoints", [])}
    assert {"SqlInjection/attack8", "CrossSiteScriptingStored/stored-xss", "IDOR/profile/2342388"} <= endpoints


def test_webgoat_stored_xss_requires_lesson_confirmation_and_readback(monkeypatch):
    stored = {"body": ""}

    def handler(request):
        if request.url.path.endswith("start.mvc"):
            return httpx.Response(200, text="WebGoat", headers={"content-type": "text/html"})
        if request.method == "POST":
            stored["body"] = request.content.decode()
            return httpx.Response(200, json={"lessonCompleted": True})
        return httpx.Response(200, json={"text": stored["body"]}, headers={"content-type": "application/json"})
    tools = lab_tools(monkeypatch, "http://webgoat:8080/WebGoat", handler)
    findings = check_lab(tools, tools.crawl(), ["stored_xss"])
    assert [f.category for f in findings] == ["Stored XSS"]
    assert findings[0].parameter == "text"


def test_webgoat_stored_xss_not_reported_without_readback(monkeypatch):
    def handler(request):
        if request.url.path.endswith("start.mvc"):
            return httpx.Response(200, text="WebGoat", headers={"content-type": "text/html"})
        if request.method == "POST":
            return httpx.Response(200, json={"lessonCompleted": True})
        return httpx.Response(200, json={"text": "no marker"}, headers={"content-type": "application/json"})
    tools = lab_tools(monkeypatch, "http://webgoat:8080/WebGoat", handler)
    assert check_lab(tools, tools.crawl(), ["stored_xss"]) == []


def test_webgoat_idor_confirms_with_lesson_oracle(monkeypatch):
    def handler(request):
        if request.url.path.endswith("start.mvc"):
            return httpx.Response(200, text="WebGoat", headers={"content-type": "text/html"})
        if request.url.path.endswith("/IDOR/login"):
            return httpx.Response(200, json={"lessonCompleted": True})
        return httpx.Response(200, json={"lessonCompleted": True})
    tools = lab_tools(monkeypatch, "http://webgoat:8080/WebGoat", handler)
    findings = check_lab(tools, tools.crawl(), ["idor"])
    assert [f.category for f in findings] == ["Potential BOLA/IDOR"]
    assert findings[0].parameter == "userId"


def test_webgoat_idor_requires_authenticated_owner(monkeypatch):
    def handler(request):
        if request.url.path.endswith("start.mvc"):
            return httpx.Response(200, text="WebGoat", headers={"content-type": "text/html"})
        if request.url.path.endswith("/IDOR/login"):
            return httpx.Response(200, json={"lessonCompleted": False})
        return httpx.Response(200, json={"lessonCompleted": True})
    tools = lab_tools(monkeypatch, "http://webgoat:8080/WebGoat", handler)
    assert check_lab(tools, tools.crawl(), ["idor"]) == []

