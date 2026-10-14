import re
import uuid
from dataclasses import dataclass
from time import perf_counter

import httpx
from bs4 import BeautifulSoup

from app.schemas import AgentTrace, Finding, LoginRequest
from app.tools import WebTools
from app.labs import check_lab
from app.reasoning import ReasoningAgent, PlanDecision, ALLOWED_TESTS, public_url, page_context


@dataclass
class AttackProbe:
    kind: str
    url: str
    parameter: str
    body: str
    status: int
    baseline_body: str | None = None
    content_type: str = "text/html"
    payload: str | None = None
    baseline_status: int | None = None


class ReconAgent:
    name = "ReconAgent"

    def __init__(self, tools: WebTools):
        self.tools = tools

    def run(self) -> list[dict]:
        return self.tools.crawl()


class PlanningAgent(ReasoningAgent):
    name = "PlanningAgent"

    def __init__(self, target_url: str):
        super().__init__()
        self.target_url = target_url

    def run(self, pages: list[dict]) -> list[str]:
        fallback = PlanDecision(rationale="Run the four bounded lab checks.", tests=ALLOWED_TESTS)
        result = self.decide(
            "Choose tests only from the allowed set; return tests and rationale.",
            {"target": public_url(self.target_url), "pages": page_context(pages), "allowed_tests": ALLOWED_TESTS},
            PlanDecision, fallback,
        )
        return list(dict.fromkeys(result.tests)) or list(ALLOWED_TESTS)


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
                        marker = f"<script>alert('sentinel-{uuid.uuid4().hex}')</script>"
                        result = self._request(form, name, marker, method)
                        probes.append(AttackProbe("reflected_xss", result["url"], name, result["body"], result["status"], content_type=result.get("headers", {}).get("content-type", ""), payload=marker))
                    if "stored_xss" in plan and form["action"].endswith("/notes"):
                        marker = f"<script>alert('sentinel-{uuid.uuid4().hex}')</script>"
                        self._request(form, name, marker, method)
                        result = self.tools.request(form["action"])
                        probes.append(AttackProbe("stored_xss", result["url"], name, result["body"], result["status"], content_type=result.get("headers", {}).get("content-type", ""), payload=marker))
                    if "basic_sqli" in plan and form.get("source") != "juice-shop-api-adapter":
                        baseline = self._request(form, name, "sentinel-baseline", method)
                        result = self._request(form, name, "'", method)
                        probes.append(AttackProbe("basic_sqli", result["url"], name, result["body"], result["status"], baseline["body"], baseline_status=baseline["status"]))
            for endpoint in page.get("endpoints", []):
                if endpoint["url"].rstrip("/").endswith("/rest/admin/application-configuration"):
                    result = self.tools.request(endpoint["url"])
                    probes.append(AttackProbe("sensitive_config", result["url"], "response", result["body"], result["status"]))
                for name in endpoint.get("parameters", []):
                    if "reflected_xss" in plan:
                        marker = f"<script>alert('sentinel-{uuid.uuid4().hex}')</script>"
                        result = self._request_endpoint(endpoint, name, marker)
                        probes.append(AttackProbe("reflected_xss", result["url"], name, result["body"], result["status"], content_type=result.get("headers", {}).get("content-type", ""), payload=marker))
                    if "basic_sqli" in plan:
                        baseline = self._request_endpoint(endpoint, name, "sentinel-baseline")
                        result = self._request_endpoint(endpoint, name, "'")
                        probes.append(AttackProbe("basic_sqli", result["url"], name, result["body"], result["status"], baseline["body"], baseline_status=baseline["status"]))
        if "idor" in plan and self.tools.target_url.rstrip("/").endswith(("/demo", "/demo-safe")):
            object_url = f"{self.tools.target_url}/object"
            if self.comparison_tools and self.tools.client.headers.get("X-Lab-User") == "user-1" and self.comparison_tools.client.headers.get("X-Lab-User") == "user-2":
                owner_session = self.tools.request(object_url, params={"id": "1"})
                other_session = self.comparison_tools.request(object_url, params={"id": "1"})
                probes.append(AttackProbe("idor", other_session["url"], "id", other_session["body"], other_session["status"], owner_session["body"], baseline_status=owner_session["status"]))
        return probes

    def _request(self, form: dict, field: str, payload: str, method: str) -> dict:
        if form.get("source") == "browser":
            return self.tools.browser_request(form, field, payload)
        values = {item["name"]: item.get("value", "") for item in form.get("inputs", [])}
        values[field] = payload
        return self.tools.request(form["action"], method, params=values if method == "GET" else None, data=values if method != "GET" else None)

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
                    if "reflected_xss" in plan and "Reflected XSS" not in confirmed and not form["action"].endswith("/notes"):
                        payloads.append(("reflected_xss", f"<img src=x onerror=alert('sentinel-{uuid.uuid4().hex}')>"))
                    if "stored_xss" in plan and "Stored XSS" not in confirmed and form["action"].endswith("/notes"):
                        payloads.append(("stored_xss", f"<img src=x onerror=alert('sentinel-{uuid.uuid4().hex}')>"))
                    if "basic_sqli" in plan and "Potential SQL Injection" not in confirmed and form.get("source") != "juice-shop-api-adapter":
                        payloads.append(("basic_sqli", "' OR '1'='1"))
                    for kind, payload in payloads:
                        baseline = self._request(form, name, "sentinel-baseline", method) if kind == "basic_sqli" else None
                        result = self._request(form, name, payload, method)
                        if kind == "stored_xss":
                            result = self.tools.request(form["action"])
                        probes.append(AttackProbe(kind, result["url"], name, result["body"], result["status"], baseline["body"] if baseline else None, result.get("headers", {}).get("content-type", ""), payload=payload, baseline_status=baseline["status"] if baseline else None))
        return probes


class VerificationAgent:
    name = "VerificationAgent"

    def run(self, probes: list[AttackProbe]) -> list[Finding]:
        findings: list[Finding] = []
        for probe in probes:
            soup = BeautifulSoup(probe.body, "html.parser") if "html" in probe.content_type and "<" in probe.body else None
            expected = BeautifulSoup(probe.payload or "<script>alert(1)</script>", "html.parser").find(["script", "img"])
            marker_present = bool(soup and expected and any(tag == expected and not tag.find_parent(["textarea", "title", "style", "template", "noscript"]) for tag in soup.find_all(expected.name)))
            if probe.kind == "reflected_xss" and "html" in probe.content_type and marker_present and 200 <= probe.status < 300:
                findings.append(Finding(category="Reflected XSS", severity="medium", url=probe.url, parameter=probe.parameter, evidence="The unique controlled marker was reflected as an HTML script or event handler. Static HTML evidence; browser execution was not verified.", recommendation="Encode output by context and apply a restrictive Content-Security-Policy."))
            if probe.kind == "stored_xss" and "html" in probe.content_type and marker_present and 200 <= probe.status < 300:
                findings.append(Finding(category="Stored XSS", severity="high", url=probe.url, parameter=probe.parameter, evidence="The controlled marker was persisted and returned by a later response.", recommendation="Validate and contextually encode stored content before rendering it. Apply a restrictive Content-Security-Policy."))
            if probe.kind == "basic_sqli":
                sql_error = re.search(r"(sql syntax|sqlite[_ ]error|SequelizeDatabaseError|SQLSyntaxErrorException|syntax error)", probe.body, re.I)
                if sql_error and probe.baseline_status is not None and 200 <= probe.baseline_status < 300 and probe.baseline_body is not None and not re.search(r"(sql syntax|sqlite[_ ]error|SequelizeDatabaseError|SQLSyntaxErrorException|syntax error)", probe.baseline_body, re.I) and probe.status != 0:
                    findings.append(Finding(category="Potential SQL Injection", severity="high", url=probe.url, parameter=probe.parameter, evidence=f"Database error signature observed: {sql_error.group(0)}.", recommendation="Use parameterized queries and avoid returning database errors to clients."))
            if probe.kind == "sensitive_config" and probe.status == 200 and '"config"' in probe.body:
                findings.append(Finding(category="Potential Sensitive Configuration Exposure", severity="medium", url=probe.url, parameter=None, evidence="An administrative application-configuration response was accessible without an authorization denial.", recommendation="Require authorization for administrative configuration endpoints and avoid exposing internal configuration to unauthenticated clients."))
            if probe.kind == "idor" and probe.status == probe.baseline_status == 200 and probe.baseline_body:
                if probe.body == probe.baseline_body and "Secret project data" in probe.body and "Owner: user-1" in probe.body:
                    evidence = "A second authorized session accessed the first session's object without an authorization denial."
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
        self.trace.append(AgentTrace(agent=self.planner.name, status=plan_status, detail=f"Selected: {', '.join(plan)}.", mode="ai" if self.used_deepseek else "fallback", decision=self.planner.decision, decision_reason=self.planner.reason, fallback_reason=self.planner.fallback_reason, llm_calls=self.llm_calls, llm_usage=self.llm_usage, llm_latency_ms=self.llm_latency_ms, llm_cost_usd=self.llm_cost_usd))
        findings = []
        probe_count = 0
        refinement_count = 0
        self.test_timings_ms = {}
        for kind in plan:
            started = perf_counter()
            probes = self.attack.run(pages, [kind])
            probe_count += len(probes)
            candidates = self.verifier.run(probes)
            candidates.extend(check_lab(self.recon.tools, pages, [kind], comparison_tools=self.attack.comparison_tools))
            refinements = self.attack.refine(pages, [kind], candidates)
            refinement_count += len(refinements)
            candidates.extend(self.verifier.run(refinements))
            findings.extend(candidates)
            self.test_timings_ms[kind] = round((perf_counter() - started) * 1000, 2)
        self.trace.append(AgentTrace(agent=self.attack.name, status="completed", detail=f"Executed {probe_count} generic probes plus lab adapter checks."))
        self.trace.append(AgentTrace(agent=self.verifier.name, status="completed", detail=f"Produced {len(findings)} candidates before deduplication."))
        self.trace.append(AgentTrace(agent="ReActFeedback", status="completed" if refinement_count else "skipped", detail=f"Executed {refinement_count} bounded refinement probes."))
        findings = list({(item.category, item.url, item.parameter): item for item in findings}.values())
        self.summary = self.reporter.run(len(pages), plan, findings)
        self.trace.append(AgentTrace(agent=self.reporter.name, status="completed", detail="Generated structured findings and remediation advice."))
        return str(uuid.uuid4()), pages, findings
