import json

import httpx

from app import toolbox as toolbox_module
from app.config import settings
from app.toolbox import ToolBox, ToolCallingAgent
from app.tools import WebTools


def _mock_tools() -> WebTools:
    def handler(request):
        return httpx.Response(200, text="<title>Lab</title><form action='/' method='get'><input name='q'></form>",
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
        [{"id": "c2", "type": "function", "function": {"name": "verify_vulnerability", "arguments": json.dumps({
            "kind": "reflected_xss", "url": "http://localhost/demo", "parameter": "q",
            "payload": "<script>alert('sentinel-x')</script>",
            "response_body": "<script>alert('sentinel-x')</script>", "status": 200, "content_type": "text/html"})}}],
        [{"id": "c3", "type": "function", "function": {"name": "audit_response_security", "arguments": "{}"}}],
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
    assert "Security Misconfiguration" in categories      # surfaced because the model CALLED audit_response_security
    assert agent.llm_calls == 4
    assert agent.llm_usage["total_tokens"] == 112
    assert agent.steps == 4
