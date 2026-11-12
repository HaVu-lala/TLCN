"""Oracle XSS phản chiếu dựa trên thực thi trình duyệt (browser-execution).

Khác với oracle phản chiếu HTML tĩnh (chỉ bắt khi marker trở thành thẻ
<script>/<img> thật), oracle này dùng Chromium để xác nhận payload thực sự được
THỰC THI trong trình duyệt — nhờ đó bắt được cả XSS trong ngữ cảnh chuỗi
JavaScript hoặc thuộc tính (ví dụ `const id='<payload>'`). Chỉ công nhận khi hộp
thoại alert mang marker duy nhất được kích hoạt, nên tỷ lệ báo động giả rất thấp:
một ứng dụng đã mã hóa đầu ra đúng cách sẽ không thực thi payload.
"""
import uuid
from urllib.parse import urlencode

from app.config import settings
from app.schemas import Finding

MAX_PARAMS = 10
# Payload cho nhiều ngữ cảnh: breakout chuỗi JS (nháy đơn/kép) và thoát thẻ HTML.
PAYLOAD_TEMPLATES = [
    "';alert('{m}')//",
    "\";alert('{m}')//",
    "'><script>alert('{m}')</script>",
    "\"><script>alert('{m}')</script>",
]


def _get_param_targets(pages: list[dict]) -> list[tuple[str, str]]:
    targets: list[tuple[str, str]] = []
    seen = set()
    for page in pages:
        for endpoint in page.get("endpoints", []):
            if endpoint.get("method", "GET").upper() != "GET":
                continue
            for param in endpoint.get("parameters", []):
                key = (endpoint["url"], param)
                if key not in seen:
                    seen.add(key)
                    targets.append(key)
    return targets[:MAX_PARAMS]


# [TN2 - XSS] Reflected XSS: oracle Chromium THỰC THI - chỉ ghi nhận khi alert mang marker duy nhất được kích hoạt.
def browser_reflected_xss(tools, pages: list[dict]) -> list[Finding]:
    """Xác nhận reflected XSS trên các GET parameter bằng cách thực thi trong Chromium."""
    if not settings.browser_scan_enabled:
        return []
    targets = _get_param_targets(pages)
    if not targets:
        return []
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return []
    findings: list[Finding] = []
    confirmed: set[tuple[str, str]] = set()
    try:
        with sync_playwright() as pw:
            browser, context = tools._browser_context(pw)
            try:
                page = context.new_page()
                executed: list[str] = []
                page.on("dialog", lambda d: (executed.append(d.message), d.dismiss()))
                for url, param in targets:
                    for template in PAYLOAD_TEMPLATES:
                        marker = "sentinel-" + uuid.uuid4().hex
                        payload = template.format(m=marker)
                        sep = "&" if "?" in url else "?"
                        full = url + sep + urlencode({param: payload})
                        executed.clear()
                        try:
                            page.goto(full, wait_until="networkidle", timeout=settings.browser_timeout_ms)
                            page.wait_for_timeout(400)
                        except Exception:
                            continue
                        if marker in " ".join(executed):
                            key = (url, param)
                            if key not in confirmed:
                                confirmed.add(key)
                                findings.append(Finding(
                                    category="Reflected XSS", severity="high", url=url, parameter=param,
                                    evidence="Chromium đã thực thi marker alert duy nhất được tiêm qua tham số GET (breakout ngữ cảnh JavaScript/HTML).",
                                    recommendation="Mã hóa đầu ra theo đúng ngữ cảnh (HTML và JavaScript) và áp dụng Content-Security-Policy chặt chẽ."))
                            break
            finally:
                context.close()
                browser.close()
    except Exception:
        return findings
    return findings
