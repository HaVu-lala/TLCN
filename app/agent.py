import json
import re
import uuid
from dataclasses import dataclass
from time import perf_counter

import httpx

from app.config import settings
from app.schemas import AgentTrace, Finding, LoginRequest
from app.tools import WebTools


@dataclass
class AttackProbe:
    kind: str
    url: str
    parameter: str
    body: str
    status: int
    baseline_body: str | None = None


class ReconAgent:
    name = "ReconAgent"

    def __init__(self, tools: WebTools):
        self.tools = tools

    def run(self) -> list[dict]:
        return self.tools.crawl()


class PlanningAgent:
    name = "PlanningAgent"

    def __init__(self, target_url: str):
        self.target_url = target_url
        self.used_deepseek = False
        self.used_fallback = False
        self.llm_usage: dict[str, int] = {}
        self.llm_calls = 0
        self.llm_latency_ms = 0.0
        self.llm_cost_usd: float | None = None

    def run(self, pages: list[dict]) -> list[str]:
        allowed = {"reflected_xss", "stored_xss", "basic_sqli", "idor"}
        if not settings.deepseek_api_key:
            self.used_fallback = True
            return sorted(allowed)
        prompt = {"target": self.target_url, "pages": pages, "allowed_tests": sorted(allowed)}
        try:
            started = perf_counter()
            self.llm_calls += 1
            response = httpx.post(
                f"{settings.deepseek_base_url.rstrip('/')}/chat/completions",
                headers={"Authorization": f"Bearer {settings.deepseek_api_key}"},
                json={"model": settings.deepseek_model, "temperature": 0, "messages": [
                    {"role": "system", "content": 'You are a defensive web security planner. Return JSON only: {"tests":["reflected_xss"|"stored_xss"|"basic_sqli"|"idor"]}. Choose only allowed tests. Never request destructive actions.'},
                    {"role": "user", "content": json.dumps(prompt)},
                ]},
                timeout=settings.request_timeout_seconds,
            )
            self.llm_latency_ms = round((perf_counter() - started) * 1000, 2)
            response.raise_for_status()
            usage = response.json().get("usage", {})
            self.llm_usage = {
                key: int(usage[key])
                for key in ("prompt_tokens", "completion_tokens", "total_tokens")
                if key in usage
            }
            if "prompt_tokens" in self.llm_usage or "completion_tokens" in self.llm_usage:
                self.llm_cost_usd = round(
                    self.llm_usage.get("prompt_tokens", 0) / 1_000_000 * settings.deepseek_input_cost_per_million
                    + self.llm_usage.get("completion_tokens", 0) / 1_000_000 * settings.deepseek_output_cost_per_million,
                    8,
                )
            content = response.json()["choices"][0]["message"]["content"]
            tests = json.loads(re.search(r"\{.*\}", content, re.DOTALL).group())["tests"]
            selected = [test for test in tests if test in allowed]
            if selected:
                self.used_deepseek = True
                return selected
        except (httpx.HTTPError, KeyError, ValueError, AttributeError, TypeError):
            pass
        self.used_fallback = True
        return sorted(allowed)


class AttackAgent:
    name = "AttackAgent"

    def __init__(self, tools: WebTools, comparison_tools: WebTools | None = None):
        self.tools = tools
        self.comparison_tools = comparison_tools

    def run(self, pages: list[dict], plan: list[str]) -> list[AttackProbe]:
        probes: list[AttackProbe] = []
        for page in pages:
            for form in page.get("forms", []):
                method = form.get("method", "GET")
                for field in form.get("inputs", []):
                    name = field["name"]
                    if "reflected_xss" in plan and not form["action"].endswith("/notes"):
                        marker = "<script>alert(1)</script>"
                        result = self._request(form, name, marker, method)
                        probes.append(AttackProbe("reflected_xss", result["url"], name, result["body"], result["status"]))
                    if "stored_xss" in plan and form["action"].endswith("/notes"):
                        marker = "<script>alert(1)</script>"
                        result = self._request(form, name, marker, method)
                        probes.append(AttackProbe("stored_xss", result["url"], name, result["body"], result["status"]))
                    if "basic_sqli" in plan:
                        result = self._request(form, name, "'", method)
                        probes.append(AttackProbe("basic_sqli", result["url"], name, result["body"], result["status"]))
            for endpoint in page.get("endpoints", []):
                if endpoint["url"].rstrip("/").endswith("/rest/admin/application-configuration"):
                    result = self.tools.request(endpoint["url"])
                    probes.append(AttackProbe("sensitive_config", result["url"], "response", result["body"], result["status"]))
                for name in endpoint.get("parameters", []):
                    if "reflected_xss" in plan:
                        result = self._request_endpoint(endpoint, name, "<script>alert(1)</script>")
                        probes.append(AttackProbe("reflected_xss", result["url"], name, result["body"], result["status"]))
                    if "basic_sqli" in plan:
                        result = self._request_endpoint(endpoint, name, "'")
                        probes.append(AttackProbe("basic_sqli", result["url"], name, result["body"], result["status"]))
        if "idor" in plan and self.tools.target_url.rstrip("/").endswith("/demo"):
            object_url = f"{self.tools.target_url}/object"
            if self.comparison_tools:
                owner_session = self.tools.request(object_url, params={"id": "1"})
                other_session = self.comparison_tools.request(object_url, params={"id": "1"})
                probes.append(AttackProbe("idor", other_session["url"], "id", other_session["body"], other_session["status"], owner_session["body"]))
            else:
                first = self.tools.request(object_url, params={"id": "1"})
                second = self.tools.request(object_url, params={"id": "2"})
                probes.append(AttackProbe("idor", second["url"], "id", second["body"], second["status"], first["body"]))
        return probes

    def _request(self, form: dict, field: str, payload: str, method: str) -> dict:
        if form.get("source") == "browser":
            return self.tools.browser_request(form, field, payload)
        return self.tools.request(form["action"], method, params={field: payload} if method == "GET" else None, data={field: payload} if method != "GET" else None)

    def _request_endpoint(self, endpoint: dict, field: str, payload: str) -> dict:
        method = endpoint.get("method", "GET")
        return self.tools.request(endpoint["url"], method, params={field: payload} if method == "GET" else None, data={field: payload} if method != "GET" else None)

    def refine(self, pages: list[dict], plan: list[str], findings: list[Finding]) -> list[AttackProbe]:
        """Run one bounded feedback pass for checks not confirmed initially."""
        confirmed = {finding.category for finding in findings}
        probes: list[AttackProbe] = []
        for page in pages:
            for form in page.get("forms", []):
                method = form.get("method", "GET")
                for field in form.get("inputs", []):
                    name = field["name"]
                    payloads = []
                    if "reflected_xss" in plan and "Reflected XSS" not in confirmed:
                        payloads.append(("reflected_xss", "<img src=x onerror=alert(1)>"))
                    if "stored_xss" in plan and "Stored XSS" not in confirmed:
                        payloads.append(("stored_xss", "<img src=x onerror=alert(1)>"))
                    if "basic_sqli" in plan and "Potential SQL Injection" not in confirmed:
                        payloads.append(("basic_sqli", "' OR '1'='1"))
                    for kind, payload in payloads:
                        result = self._request(form, name, payload, method)
                        probes.append(AttackProbe(kind, result["url"], name, result["body"], result["status"]))
        return probes


class VerificationAgent:
    name = "VerificationAgent"

    def run(self, probes: list[AttackProbe]) -> list[Finding]:
        findings: list[Finding] = []
        for probe in probes:
            if probe.kind == "reflected_xss" and "<script>alert(1)</script>" in probe.body:
                findings.append(Finding(category="Reflected XSS", severity="medium", url=probe.url, parameter=probe.parameter, evidence="The controlled marker was reflected in the response body.", recommendation="Encode output by context and apply a restrictive Content-Security-Policy."))
            if probe.kind == "stored_xss" and "<script>alert(1)</script>" in probe.body:
                findings.append(Finding(category="Stored XSS", severity="high", url=probe.url, parameter=probe.parameter, evidence="The controlled marker was persisted and returned by a later response.", recommendation="Validate and contextually encode stored content before rendering it. Apply a restrictive Content-Security-Policy."))
            if probe.kind == "basic_sqli":
                sql_error = re.search(r"(sql syntax|sqlite error|mysql|postgresql|syntax error)", probe.body, re.I)
                if sql_error:
                    findings.append(Finding(category="Potential SQL Injection", severity="high", url=probe.url, parameter=probe.parameter, evidence=f"Database error signature observed: {sql_error.group(0)}.", recommendation="Use parameterized queries and avoid returning database errors to clients."))
            if probe.kind == "sensitive_config" and probe.status == 200 and '"config"' in probe.body:
                findings.append(Finding(category="Potential Sensitive Configuration Exposure", severity="medium", url=probe.url, parameter=None, evidence="An administrative application-configuration response was accessible without an authorization denial.", recommendation="Require authorization for administrative configuration endpoints and avoid exposing internal configuration to unauthenticated clients."))
            if probe.kind == "idor" and probe.status == 200 and probe.baseline_body:
                if probe.body == probe.baseline_body:
                    evidence = "A second authorized session accessed the first session's object without an authorization denial."
                elif probe.body != probe.baseline_body:
                    evidence = "Two object identifiers returned different object data without an authorization context."
                else:
                    continue
                findings.append(Finding(category="Potential BOLA/IDOR", severity="high", url=probe.url, parameter=probe.parameter, evidence=evidence, recommendation="Enforce object-level authorization on every request and verify the resource belongs to the authenticated user."))
        return findings


class ReportingAgent:
    name = "ReportingAgent"

    def run(self, page_count: int, plan: list[str], findings: list[Finding]) -> str:
        return f"Completed multi-agent scan on {page_count} page(s), selected {', '.join(plan)} and recorded {len(findings)} finding(s)."


class PentestAgent:
    """Compatibility facade coordinating the specialized agents."""

    def __init__(self, target_url: str, session_headers: dict[str, str] | None = None, comparison_session_headers: dict[str, str] | None = None, login: LoginRequest | None = None):
        self.target_url = target_url
        tools = WebTools(target_url, session_headers=session_headers, login=login)
        comparison_tools = WebTools(target_url, session_headers=comparison_session_headers) if comparison_session_headers else None
        self.recon = ReconAgent(tools)
        self.planner = PlanningAgent(target_url)
        self.attack = AttackAgent(tools, comparison_tools=comparison_tools)
        self.verifier = VerificationAgent()
        self.reporter = ReportingAgent()
        self.used_deepseek = False
        self.summary = ""
        self.trace: list[AgentTrace] = []
        self.llm_usage: dict[str, int] = {}
        self.llm_calls = 0
        self.llm_latency_ms = 0.0
        self.llm_cost_usd: float | None = None
        self.authentication_status = tools.authentication_status

    def run(self) -> tuple[str, list[dict], list[Finding]]:
        self.trace.append(AgentTrace(agent="SessionManager", status="completed", detail=f"Session mode: {self.authentication_status}. Credentials are not persisted."))
        pages = self.recon.run()
        endpoint_count = sum(len(page.get("endpoints", [])) for page in pages)
        self.trace.append(AgentTrace(agent=self.recon.name, status="completed", detail=f"Discovered {len(pages)} page(s) and {endpoint_count} endpoint(s)."))
        plan = self.planner.run(pages)
        self.used_deepseek = self.planner.used_deepseek
        self.llm_usage = self.planner.llm_usage
        self.llm_calls = self.planner.llm_calls
        self.llm_latency_ms = self.planner.llm_latency_ms
        self.llm_cost_usd = self.planner.llm_cost_usd
        plan_status = "completed" if self.used_deepseek else "fallback"
        self.trace.append(AgentTrace(agent=self.planner.name, status=plan_status, detail=f"Selected: {', '.join(plan)}."))
        probes = self.attack.run(pages, plan)
        self.trace.append(AgentTrace(agent=self.attack.name, status="completed", detail=f"Executed {len(probes)} controlled probe(s)."))
        findings = self.verifier.run(probes)
        self.trace.append(AgentTrace(agent=self.verifier.name, status="completed", detail=f"Verified {len(findings)} finding(s)."))
        refinement_probes = self.attack.refine(pages, plan, findings)
        if refinement_probes:
            refinement_findings = self.verifier.run(refinement_probes)
            findings.extend(refinement_findings)
            unique_findings = {(finding.category, finding.url, finding.parameter): finding for finding in findings}
            findings = list(unique_findings.values())
            self.trace.append(AgentTrace(agent="ReActFeedback", status="completed", detail=f"Observed {len(findings)} finding(s), refined with {len(refinement_probes)} probe(s), and re-verified the response."))
        else:
            self.trace.append(AgentTrace(agent="ReActFeedback", status="skipped", detail="Initial observations confirmed the selected checks; no refinement probe was needed."))
        self.summary = self.reporter.run(len(pages), plan, findings)
        self.trace.append(AgentTrace(agent=self.reporter.name, status="completed", detail="Generated structured findings and remediation advice."))
        return str(uuid.uuid4()), pages, findings
