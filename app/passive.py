"""Passive, non-destructive detectors for OWASP Top 10:2025 signals that are
observable directly in an HTTP response, without sending any attack payload.

Covered categories:
  * A02:2025 - Security Misconfiguration (missing security headers, leaked stack traces)
  * A03:2025 - Software Supply Chain / component version disclosure
  * A04:2025 - Cryptographic Failures (insecure cookies, missing transport hardening)

These checks only read response metadata and body text that the server already
returned, so they add no destructive traffic and cannot alter target state.
"""
import re
from urllib.parse import urlparse

from app.schemas import Finding

# Response security headers expected on an HTML document.
EXPECTED_SECURITY_HEADERS = {
    "content-security-policy": "Content-Security-Policy",
    "x-frame-options": "X-Frame-Options",
    "x-content-type-options": "X-Content-Type-Options",
}

# Headers that commonly disclose a concrete component version (A03 cross-check with CVEs).
VERSION_HEADERS = ("server", "x-powered-by", "x-aspnet-version", "x-aspnetmvc-version", "x-generator")
VERSION_VALUE = re.compile(r"\d+\.\d+")

# Server-side error disclosure signatures (A02: debug / stack trace leakage).
STACK_TRACE = re.compile(
    r"(Traceback \(most recent call last\)|java\.lang\.[A-Za-z.]+Exception"
    r"|at [\w.$]+\([\w.]+\.(?:java|py|rb|php):\d+\)|Warning: .+ on line \d+"
    r"|Fatal error:|ORA-\d{5}|Microsoft OLE DB|System\.[A-Za-z.]+Exception)",
    re.I,
)


def _headers_lower(headers: dict | None) -> dict[str, str]:
    return {str(key).lower(): str(value) for key, value in (headers or {}).items()}


def _target_page(pages: list[dict], target_url: str | None) -> dict | None:
    """Analyse the target root response only, to keep passive findings bounded."""
    if target_url:
        target_path = urlparse(target_url).path.rstrip("/") or "/"
        for page in pages:
            if page.get("status") == 200 and (urlparse(page.get("url", "")).path.rstrip("/") or "/") == target_path:
                return page
    return next((page for page in pages if page.get("status") == 200), None)


def _is_html(headers: dict[str, str], page: dict) -> bool:
    content_type = headers.get("content-type", page.get("content_type", ""))
    return "html" in content_type.lower()


def _a02(url: str, headers: dict[str, str], body: str, is_html: bool) -> list[Finding]:
    findings: list[Finding] = []
    if is_html:
        missing = [label for key, label in EXPECTED_SECURITY_HEADERS.items() if key not in headers]
        if missing:
            findings.append(Finding(
                category="Security Misconfiguration", severity="medium", url=url, parameter=None,
                evidence="The HTML response is missing security response headers: " + ", ".join(missing) + ".",
                recommendation="Set Content-Security-Policy, X-Frame-Options and X-Content-Type-Options on application responses.",
            ))
    trace = STACK_TRACE.search(body or "")
    if trace:
        findings.append(Finding(
            category="Security Misconfiguration", severity="medium", url=url, parameter=None,
            evidence=f"The response leaked a server error signature: {trace.group(0)[:80]}.",
            recommendation="Disable debug mode in production and return a generic error page without stack traces.",
        ))
    return findings


def _a03(url: str, headers: dict[str, str]) -> list[Finding]:
    disclosed = [f"{header}: {headers[header]}" for header in VERSION_HEADERS
                 if header in headers and VERSION_VALUE.search(headers[header])]
    if not disclosed:
        return []
    return [Finding(
        category="Software Supply Chain Exposure", severity="low", url=url, parameter=None,
        evidence="Response headers disclosed component versions that can be matched against public CVEs: " + "; ".join(disclosed) + ".",
        recommendation="Suppress version banners (Server, X-Powered-By) and track dependency CVEs with an SBOM/SCA process.",
    )]


def _a04(url: str, headers: dict[str, str]) -> list[Finding]:
    findings: list[Finding] = []
    scheme = urlparse(url).scheme
    raw_cookie = headers.get("set-cookie", "")
    if raw_cookie:
        lowered = raw_cookie.lower()
        missing = [flag for flag, token in (("HttpOnly", "httponly"), ("SameSite", "samesite")) if token not in lowered]
        if scheme == "https" and "secure" not in lowered:
            missing.append("Secure")
        if missing:
            findings.append(Finding(
                category="Cryptographic Failures", severity="medium", url=url, parameter=None,
                evidence="A Set-Cookie response was issued without the attribute(s): " + ", ".join(missing) + ".",
                recommendation="Set HttpOnly, Secure and SameSite on session cookies to protect them in transit and from scripts.",
            ))
    if scheme == "https" and "strict-transport-security" not in headers:
        findings.append(Finding(
            category="Cryptographic Failures", severity="low", url=url, parameter=None,
            evidence="The HTTPS response did not send a Strict-Transport-Security (HSTS) header.",
            recommendation="Enable HSTS to force encrypted transport and prevent protocol downgrade.",
        ))
    return findings


def passive_findings(pages: list[dict], target_url: str | None = None) -> list[Finding]:
    """Return deduplicated passive findings for the target root response."""
    page = _target_page(pages, target_url)
    if page is None:
        return []
    headers = _headers_lower(page.get("headers"))
    body = page.get("body", "") or ""
    if not headers and not body:
        return []
    url = page.get("url", target_url or "")
    is_html = _is_html(headers, page)
    findings = _a02(url, headers, body, is_html) + _a03(url, headers) + _a04(url, headers)
    unique: dict[tuple, Finding] = {}
    for finding in findings:
        unique.setdefault((finding.category, finding.url, finding.parameter), finding)
    return list(unique.values())
