"""Bộ dò THỤ ĐỘNG cho các dấu hiệu OWASP Top 10:2025 quan sát trực tiếp trong phản hồi HTTP.

"Thụ động" nghĩa là chỉ ĐỌC metadata và nội dung máy chủ đã trả về, không gửi bất
kỳ payload tấn công nào, nên không thêm lưu lượng phá hoại và không thể thay đổi
trạng thái mục tiêu. Các nhóm được phủ:

  * A02:2025 - Security Misconfiguration (thiếu security header, lộ stack trace)
  * A03:2025 - Software Supply Chain (lộ phiên bản thành phần qua header)
  * A04:2025 - Cryptographic Failures (cookie thiếu cờ an toàn, thiếu HSTS)
"""
import re
from urllib.parse import urlparse

from app.schemas import Finding

# Các security header kỳ vọng có trên một tài liệu HTML.
EXPECTED_SECURITY_HEADERS = {
    "content-security-policy": "Content-Security-Policy",
    "x-frame-options": "X-Frame-Options",
    "x-content-type-options": "X-Content-Type-Options",
}

# Các header thường lộ phiên bản thành phần cụ thể (A03, để đối chiếu CVE).
VERSION_HEADERS = ("server", "x-powered-by", "x-aspnet-version", "x-aspnetmvc-version", "x-generator")
VERSION_VALUE = re.compile(r"\d+\.\d+")

# Chữ ký lộ lỗi phía máy chủ (A02: lộ debug / stack trace).
STACK_TRACE = re.compile(
    r"(Traceback \(most recent call last\)|java\.lang\.[A-Za-z.]+Exception"
    r"|at [\w.$]+\([\w.]+\.(?:java|py|rb|php):\d+\)|Warning: .+ on line \d+"
    r"|Fatal error:|ORA-\d{5}|Microsoft OLE DB|System\.[A-Za-z.]+Exception)",
    re.I,
)


def _headers_lower(headers: dict | None) -> dict[str, str]:
    """Chuẩn hóa dict header về khóa viết thường, giá trị chuỗi."""
    return {str(key).lower(): str(value) for key, value in (headers or {}).items()}


def _target_page(pages: list[dict], target_url: str | None) -> dict | None:
    """Chọn trang gốc mục tiêu (ưu tiên đúng path, trả 200) để giữ phạm vi thụ động gọn."""
    if target_url:
        target_path = urlparse(target_url).path.rstrip("/") or "/"
        for page in pages:
            if page.get("status") == 200 and (urlparse(page.get("url", "")).path.rstrip("/") or "/") == target_path:
                return page
    return next((page for page in pages if page.get("status") == 200), None)


def _is_html(headers: dict[str, str], page: dict) -> bool:
    """True nếu phản hồi là HTML (dựa content-type của header hoặc của trang)."""
    content_type = headers.get("content-type", page.get("content_type", ""))
    return "html" in content_type.lower()


def _a02(url: str, headers: dict[str, str], body: str, is_html: bool) -> list[Finding]:
    """A02: báo thiếu security header (chỉ với HTML) và lộ stack trace trong thân phản hồi."""
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
    """A03: báo khi header lộ phiên bản thành phần (có thể tra cứu CVE)."""
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
    """A04: báo cookie thiếu HttpOnly/Secure/SameSite và phản hồi HTTPS thiếu HSTS."""
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


def _dedup(findings: list[Finding]) -> list[Finding]:
    """Khử trùng lặp theo (category, url, parameter), giữ bản gặp đầu tiên."""
    unique: dict[tuple, Finding] = {}
    for finding in findings:
        unique.setdefault((finding.category, finding.url, finding.parameter), finding)
    return list(unique.values())


def _target_ctx(pages: list[dict], target_url: str | None):
    """Chọn trang gốc mục tiêu và trả về (page, headers, body, url) hoặc None."""
    page = _target_page(pages, target_url)
    if page is None:
        return None
    headers = _headers_lower(page.get("headers"))
    body = page.get("body", "") or ""
    if not headers and not body:
        return None
    url = page.get("url", target_url or "")
    return page, headers, body, url


def a02_findings(pages: list[dict], target_url: str | None = None) -> list[Finding]:
    """[Kịch bản 4] A02 Security Misconfiguration: thiếu security header, lộ stack trace."""
    ctx = _target_ctx(pages, target_url)
    if ctx is None:
        return []
    page, headers, body, url = ctx
    return _dedup(_a02(url, headers, body, _is_html(headers, page)))


def a03_findings(pages: list[dict], target_url: str | None = None) -> list[Finding]:
    """[Kịch bản 5] A03 Software Supply Chain: lộ phiên bản thành phần qua header."""
    ctx = _target_ctx(pages, target_url)
    if ctx is None:
        return []
    _page, headers, _body, url = ctx
    return _dedup(_a03(url, headers))


def a04_findings(pages: list[dict], target_url: str | None = None) -> list[Finding]:
    """[Kịch bản 6] A04 Cryptographic Failures: cookie thiếu cờ an toàn, thiếu HSTS."""
    ctx = _target_ctx(pages, target_url)
    if ctx is None:
        return []
    _page, headers, _body, url = ctx
    return _dedup(_a04(url, headers))


# [TN4 - Kiểm thụ động] Gộp A02 (misconfig/header) + A03 (lộ phiên bản) + A04 (cookie/HSTS); chỉ đọc phản hồi, mỗi nhóm một Finding riêng.
def passive_findings(pages: list[dict], target_url: str | None = None) -> list[Finding]:
    """Trả về các phát hiện thụ động (A02+A03+A04) đã khử trùng cho trang gốc mục tiêu.

    Giữ lại như API gộp cho kiểm thử; mỗi nhóm đã tách thành một hàm riêng để ánh xạ
    đúng một kịch bản (TN4/TN5/TN6).
    """
    return _dedup(
        a02_findings(pages, target_url)
        + a03_findings(pages, target_url)
        + a04_findings(pages, target_url)
    )
