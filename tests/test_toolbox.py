import json
from urllib.parse import parse_qsl

import httpx

from app import toolbox as toolbox_module
from app.config import settings
from app.toolbox import ToolBox, ToolCallingAgent
from app.tools import WebTools


def _mock_tools() -> WebTools:
    def handler(request):
        q = request.url.params.get("q", "")
        body = f"<title>Lab</title><form action='/' method='get'><input name='q'></form><div>{q}</div>"
        return httpx.Response(200, text=body,
                              headers={"content-type": "text/html", "server": "Werkzeug/2.0.3", "set-cookie": "s=1; Path=/"})
    tools = WebTools("http://localhost/demo")
    tools.client.close()
    tools.client = httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=True)
    return tools


def _message(tool_calls):
    return {"choices": [{"message": {"content": "", "tool_calls": tool_calls}}],
            "usage": {"prompt_tokens": 20, "completion_tokens": 8, "total_tokens": 28}}


def test_tool_calling_loop_executes_tools_and_confirms_finding(monkeypatch):
    monkeypatch.setattr(settings, "deepseek_api_key", "fake-key")
    monkeypatch.setattr(settings, "browser_scan_enabled", False)

    script = [
        [{"id": "c1", "type": "function", "function": {"name": "reconnaissance", "arguments": "{}"}}],
        [{"id": "c2", "type": "function", "function": {"name": "probe_and_verify", "arguments": json.dumps({
            "kind": "reflected_xss", "url": "http://localhost/demo", "parameter": "q",
            "payload": "<script>alert('sentinel-x')</script>"})}}],
        [{"id": "c3", "type": "function", "function": {"name": "run_security_checks", "arguments": "{}"}}],
        [{"id": "c4", "type": "function", "function": {"name": "generate_report", "arguments": "{}"}}],
    ]
    calls = {"n": 0}

    def fake_post(url, **kwargs):
        # The model is only ever asked to choose tools; it never performs the request itself.
        assert kwargs["json"]["tools"]
        index = min(calls["n"], len(script) - 1)
        calls["n"] += 1
        return httpx.Response(200, request=httpx.Request("POST", url), json=_message(script[index]))

    monkeypatch.setattr(toolbox_module.httpx, "post", fake_post)

    tools = _mock_tools()
    agent = ToolCallingAgent("http://localhost/demo", ToolBox(tools))
    findings = agent.run()
    tools.client.close()

    categories = {f.category for f in findings}
    assert "Reflected XSS" in categories                 # confirmed by the deterministic oracle
    assert "Security Misconfiguration" in categories      # surfaced because the model CALLED run_security_checks
    assert agent.llm_calls == 4
    assert agent.llm_usage["total_tokens"] == 112
    assert agent.steps == 4
    assert agent.auto_completed == []           # the model called run_security_checks itself


def test_function_calling_auto_runs_skipped_security_checks(monkeypatch):
    # The model stops after reconnaissance + generate_report and never calls run_security_checks.
    # The orchestrator must still run the standing battery, surface its findings, and record
    # that it auto-ran the skipped mandatory check instead of silently reporting "completed".
    monkeypatch.setattr(settings, "deepseek_api_key", "fake-key")
    monkeypatch.setattr(settings, "browser_scan_enabled", False)
    script = [
        [{"id": "c1", "type": "function", "function": {"name": "reconnaissance", "arguments": "{}"}}],
        [{"id": "c2", "type": "function", "function": {"name": "generate_report", "arguments": "{}"}}],
    ]
    calls = {"n": 0}

    def fake_post(url, **kwargs):
        index = min(calls["n"], len(script) - 1)
        calls["n"] += 1
        return httpx.Response(200, request=httpx.Request("POST", url), json=_message(script[index]))

    monkeypatch.setattr(toolbox_module.httpx, "post", fake_post)
    tools = _mock_tools()
    agent = ToolCallingAgent("http://localhost/demo", ToolBox(tools))
    findings = agent.run()
    tools.client.close()

    assert agent.auto_completed == ["run_security_checks"]
    assert "Auto-ran skipped mandatory check" in agent.trace_detail
    assert any(f.category == "Security Misconfiguration" for f in findings)


def _login_tools(require_password: bool = True) -> WebTools:
    """A login endpoint where a single quote in username triggers a 500 only when the
    companion password field is also present (required-field validation runs first)."""
    def handler(request):
        body = dict(parse_qsl(request.content.decode()))
        if require_password and not body.get("password"):
            return httpx.Response(401, json={"error": "Invalid credentials"})
        if "'" in body.get("username", ""):
            return httpx.Response(500, json={"error": "Login failed"})
        return httpx.Response(401, json={"error": "Invalid credentials"})
    tools = WebTools("http://localhost/")
    tools.client.close()
    tools.client = httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=True)
    return tools


LOGIN_FORM_PAGES = [{"forms": [{"action": "http://localhost/api/login", "method": "POST",
                                "inputs": [{"name": "username", "type": "text"},
                                           {"name": "password", "type": "password"}]}],
                     "endpoints": []}]


def test_probe_and_verify_fills_companion_form_field():
    tools = _login_tools()
    box = ToolBox(tools)
    box.pages = LOGIN_FORM_PAGES
    result = box.probe_and_verify("http://localhost/api/login", "username", "'", "basic_sqli", "POST")
    tools.client.close()
    assert result["confirmed"]
    assert any(f["category"] == "Potential SQL Injection" for f in result["findings"])


def test_probe_and_verify_without_context_misses_required_field():
    # No matching form in recon: the bare single-field request omits the required password,
    # so the server rejects it with 401 and the SQLi oracle correctly stays silent.
    tools = _login_tools()
    box = ToolBox(tools)
    box.pages = [{"forms": [], "endpoints": []}]
    result = box.probe_and_verify("http://localhost/api/login", "username", "'", "basic_sqli", "POST")
    tools.client.close()
    assert not result["confirmed"]
    assert result["findings"] == []


def test_probe_and_verify_prefers_context_matching_requested_method():
    # A GET and a POST form share the action and the "q" parameter; the GET is listed first.
    # Probing with method="POST" must select the POST context, not the first (GET) match.
    seen = {}

    def handler(request):
        seen["method"] = request.method
        return httpx.Response(200, text="<title>x</title>")
    tools = WebTools("http://localhost/")
    tools.client.close()
    tools.client = httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=True)
    box = ToolBox(tools)
    box.pages = [{"forms": [
        {"action": "http://localhost/search", "method": "GET", "inputs": [{"name": "q"}]},
        {"action": "http://localhost/search", "method": "POST", "inputs": [{"name": "q"}]},
    ], "endpoints": []}]
    box.probe_and_verify("http://localhost/search", "q", "'", "basic_sqli", "POST")
    tools.client.close()
    assert seen["method"] == "POST"


def test_probe_and_verify_fills_companion_json_field():
    def handler(request):
        body = json.loads(request.content.decode())
        if not body.get("password"):
            return httpx.Response(401, json={"error": "Invalid credentials"})
        if "'" in body.get("username", ""):
            return httpx.Response(500, json={"error": "Login failed"})
        return httpx.Response(401, json={"error": "Invalid credentials"})
    tools = WebTools("http://localhost/")
    tools.client.close()
    tools.client = httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=True)
    box = ToolBox(tools)
    box.pages = [{"forms": [], "endpoints": [{"url": "http://localhost/api/login", "method": "POST",
                                              "json_fields": ["username", "password"]}]}]
    result = box.probe_and_verify("http://localhost/api/login", "username", "'", "basic_sqli", "POST")
    tools.client.close()
    assert result["confirmed"]
    assert any(f["category"] == "Potential SQL Injection" for f in result["findings"])
