"""Registry of standing security detectors.

This is the single extension point behind Tool 4 (run_security_checks) and the
deterministic pipeline's standing-check phase. Adding a new OWASP check is a
one-line @register below; no tool, schema, prompt or orchestration change is
needed, and both the function-calling and deterministic modes pick it up at once.

Every detector keeps its own evidence-based oracle and is isolated in try/except,
so registering one can neither raise another's false-positive rate nor abort the
battery if it errors on an unusual target.
"""
from dataclasses import dataclass
from typing import Callable

from app.access_control import check_access_control
from app.auth_checks import check_authentication
from app.browser_xss import browser_reflected_xss
from app.labs import extended_lab_checks
from app.passive import passive_findings
from app.schemas import Finding


@dataclass
class DetectorContext:
    """Everything a standing detector may need, passed uniformly."""
    tools: object
    pages: list[dict]
    comparison_tools: object | None = None


Detector = Callable[[DetectorContext], list[Finding]]
STANDING_DETECTORS: list[tuple[str, Detector]] = []


def register(name: str) -> Callable[[Detector], Detector]:
    """Register a standing detector under a human-readable name."""
    def decorator(fn: Detector) -> Detector:
        STANDING_DETECTORS.append((name, fn))
        return fn
    return decorator


@register("A02/A03/A04 passive response audit")
def _passive(ctx: DetectorContext) -> list[Finding]:
    return passive_findings(ctx.pages, ctx.tools.target_url)


@register("A07 authentication weaknesses")
def _authentication(ctx: DetectorContext) -> list[Finding]:
    return check_authentication(ctx.tools, ctx.pages)


@register("A01 broken access control (forced browsing)")
def _access_control(ctx: DetectorContext) -> list[Finding]:
    return check_access_control(ctx.tools, ctx.pages)


@register("lab A02/A07 extended checks")
def _extended_lab(ctx: DetectorContext) -> list[Finding]:
    return extended_lab_checks(ctx.tools, ctx.pages)


@register("A05 reflected XSS (browser oracle)")
def _browser_xss(ctx: DetectorContext) -> list[Finding]:
    return browser_reflected_xss(ctx.tools, ctx.pages)


@register("A01 BOLA/IDOR (two sessions)")
def _bola_two_session(ctx: DetectorContext) -> list[Finding]:
    if not ctx.comparison_tools:
        return []
    # Imported lazily to avoid a circular import with app.agent.
    from app.agent import AttackProbe, VerificationAgent
    target = ctx.tools.target_url.rstrip("/") + "/object"
    owner = ctx.tools.request(target, params={"id": "1"})
    other = ctx.comparison_tools.request(target, params={"id": "1"})
    probe = AttackProbe("idor", other["url"], "id", other["body"], other["status"],
                        owner["body"], baseline_status=owner["status"])
    return VerificationAgent().run([probe])


def run_all(ctx: DetectorContext) -> list[Finding]:
    """Run every registered standing detector; a failure in one is skipped."""
    findings: list[Finding] = []
    for _name, detector in STANDING_DETECTORS:
        try:
            findings.extend(detector(ctx) or [])
        except Exception:  # noqa: BLE001 - one detector must not abort the battery
            continue
    return findings
