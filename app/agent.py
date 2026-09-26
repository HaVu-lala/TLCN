import json
import re
import uuid
from dataclasses import dataclass

import httpx

from app.config import settings
from app.schemas import AgentTrace, Finding
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

    def run(self, pages: list[dict]) -> list[str]:
        allowed = {"reflected_xss", "basic_sqli", "idor"}
        if not settings.deepseek_api_key:
            self.used_fallback = True
            return sorted(allowed)
        prompt = {"target": self.target_url, "pages": pages, "allowed_tests": sorted(allowed)}
        try:
            response = httpx.post(
                f"{settings.deepseek_base_url.rstrip('/')}/chat/completions",
                headers={"Authorization": f"Bearer {settings.deepseek_api_key}"},
                json={"model": settings.deepseek_model, "temperature": 0, "messages": [
                    {"role": "system", "content": 'You are a defensive web security planner. Return JSON only: {"tests":["reflected_xss"|"basic_sqli"|"idor"]}. Choose only allowed tests. Never request destructive actions.'},
                    {"role": "user", "content": json.dumps(prompt)},
                ]},
                timeout=settings.request_timeout_seconds,
            )
            response.raise_for_status()
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

    def __init__(self, tools: WebTools):
        self.tools = tools

    def run(self, pages: list[dict], plan: list[str]) -> list[AttackProbe]:
        probes: list[AttackProbe] = []
        for page in pages:
            for form in page.get("forms", []):
                method = form.get("method", "GET")
                for field in form.get("inputs", []):
                    name = field["name"]
                    if "reflected_xss" in plan:
                        marker = "<script>alert(1)</script>"
                        result = self.tools.request(form["action"], method, params={name: marker} if method == "GET" else None, data={name: marker} if method != "GET" else None)
                        probes.append(AttackProbe("reflected_xss", result["url"], name, result["body"], result["status"]))
                    if "basic_sqli" in plan:
                        result = self.tools.request(form["action"], method, params={name: "'"} if method == "GET" else None, data={name: "'"} if method != "GET" else None)
                        probes.append(AttackProbe("basic_sqli", result["url"], name, result["body"], result["status"]))
        if "idor" in plan:
            object_url = f"{self.tools.target_url}/object"
            first = self.tools.request(object_url, params={"id": "1"})
            second = self.tools.request(object_url, params={"id": "2"})
            probes.append(AttackProbe("idor", second["url"], "id", second["body"], second["status"], first["body"]))
        return probes


class VerificationAgent:
    name = "VerificationAgent"

    def run(self, probes: list[AttackProbe]) -> list[Finding]:
        findings: list[Finding] = []
        for probe in probes:
            if probe.kind == "reflected_xss" and "<script>alert(1)</script>" in probe.body:
                findings.append(Finding(category="Reflected XSS", severity="medium", url=probe.url, parameter=probe.parameter, evidence="The controlled marker was reflected in the response body.", recommendation="Encode output by context and apply a restrictive Content-Security-Policy."))
            if probe.kind == "basic_sqli":
                sql_error = re.search(r"(sql syntax|sqlite error|mysql|postgresql|syntax error)", probe.body, re.I)
                if sql_error:
                    findings.append(Finding(category="Potential SQL Injection", severity="high", url=probe.url, parameter=probe.parameter, evidence=f"Database error signature observed: {sql_error.group(0)}.", recommendation="Use parameterized queries and avoid returning database errors to clients."))
            if probe.kind == "idor" and probe.status == 200 and probe.baseline_body and probe.body != probe.baseline_body:
                findings.append(Finding(category="Potential BOLA/IDOR", severity="high", url=probe.url, parameter=probe.parameter, evidence="Two object identifiers returned different object data without an authorization context.", recommendation="Enforce object-level authorization on every request and verify the resource belongs to the authenticated user."))
        return findings


class ReportingAgent:
    name = "ReportingAgent"

    def run(self, page_count: int, plan: list[str], findings: list[Finding]) -> str:
        return f"Completed multi-agent scan on {page_count} page(s), selected {', '.join(plan)} and recorded {len(findings)} finding(s)."


class PentestAgent:
    """Compatibility facade coordinating the specialized agents."""

    def __init__(self, target_url: str):
        self.target_url = target_url
        tools = WebTools(target_url)
        self.recon = ReconAgent(tools)
        self.planner = PlanningAgent(target_url)
        self.attack = AttackAgent(tools)
        self.verifier = VerificationAgent()
        self.reporter = ReportingAgent()
        self.used_deepseek = False
        self.summary = ""
        self.trace: list[AgentTrace] = []

    def run(self) -> tuple[str, list[dict], list[Finding]]:
        pages = self.recon.run()
        self.trace.append(AgentTrace(agent=self.recon.name, status="completed", detail=f"Discovered {len(pages)} page(s)."))
        plan = self.planner.run(pages)
        self.used_deepseek = self.planner.used_deepseek
        plan_status = "completed" if self.used_deepseek else "fallback"
        self.trace.append(AgentTrace(agent=self.planner.name, status=plan_status, detail=f"Selected: {', '.join(plan)}."))
        probes = self.attack.run(pages, plan)
        self.trace.append(AgentTrace(agent=self.attack.name, status="completed", detail=f"Executed {len(probes)} controlled probe(s)."))
        findings = self.verifier.run(probes)
        self.trace.append(AgentTrace(agent=self.verifier.name, status="completed", detail=f"Verified {len(findings)} finding(s)."))
        self.summary = self.reporter.run(len(pages), plan, findings)
        self.trace.append(AgentTrace(agent=self.reporter.name, status="completed", detail="Generated structured findings and remediation advice."))
        return str(uuid.uuid4()), pages, findings
