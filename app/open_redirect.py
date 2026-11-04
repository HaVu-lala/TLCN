"""Detector Open Redirect (chuyển hướng mở) - kiểm thử CHỦ ĐỘNG, oracle sạch.

Cơ chế khác hẳn họ tiêm nhiễm: không soi body mà soi header Location. Với mỗi
tham số trông giống đích chuyển hướng (redirect, url, next, return...), tiêm một
URL trỏ ra domain ngoài do ta tự đặt rồi gửi yêu cầu KHÔNG đi theo chuyển hướng.

Oracle chỉ công nhận khi: phản hồi là mã 3xx VÀ header Location trỏ đúng ra domain
ngoài đã tiêm. Bằng chứng nhị phân, không phá dữ liệu, nên tỷ lệ báo động giả ~0:
ứng dụng kiểm tra đích hợp lệ sẽ không chuyển hướng ra ngoài.
"""
from urllib.parse import urlparse

from app.schemas import Finding

# Tên tham số thường là đích chuyển hướng.
REDIRECT_PARAM_NAMES = {
    "redirect", "redirect_uri", "redirect_url", "redirecturl", "url", "next",
    "return", "returnurl", "return_url", "dest", "destination", "continue",
    "goto", "redir", "to", "out", "target", "link", "forward", "returnto",
}
PAYLOAD_HOST = "sentinel-redirect.test"
PAYLOAD = "https://sentinel-redirect.test/evil"
MAX_TARGETS = 10


def _candidates(pages: list[dict]) -> list[tuple[str, str, str]]:
    """Thu các (url, tham_số, method) có tên giống đích chuyển hướng."""
    targets: list[tuple[str, str, str]] = []
    seen: set[tuple[str, str]] = set()
    for page in pages:
        for endpoint in page.get("endpoints", []):
            if endpoint.get("method", "GET").upper() != "GET":
                continue
            for param in endpoint.get("parameters", []):
                if (param or "").lower() in REDIRECT_PARAM_NAMES:
                    key = (endpoint.get("url", ""), param)
                    if key not in seen:
                        seen.add(key)
                        targets.append((endpoint.get("url", ""), param, "GET"))
        for form in page.get("forms", []):
            method = form.get("method", "GET").upper()
            for item in form.get("inputs", []):
                name = item.get("name") or ""
                if name.lower() in REDIRECT_PARAM_NAMES:
                    key = (form.get("action", ""), name)
                    if key not in seen:
                        seen.add(key)
                        targets.append((form.get("action", ""), name, method))
    return targets[:MAX_TARGETS]


def check_open_redirect(tools, pages: list[dict]) -> list[Finding]:
    findings: list[Finding] = []
    seen: set[tuple] = set()
    for url, param, method in _candidates(pages):
        if not url:
            continue
        response = tools.request(
            url, method,
            params={param: PAYLOAD} if method == "GET" else None,
            data={param: PAYLOAD} if method != "GET" else None,
            follow_redirects=False,
        )
        status = response.get("status", 0)
        if not (300 <= status < 400):
            continue
        location = response.get("headers", {}).get("location", "")
        # Oracle: Location phải trỏ đúng ra domain ngoài mình đã tiêm.
        if urlparse(location).netloc.lower() == PAYLOAD_HOST:
            key = ("Open Redirect", url, param)
            if key in seen:
                continue
            seen.add(key)
            findings.append(Finding(
                category="Open Redirect", severity="medium", url=url, parameter=param,
                evidence=f"Tham số '{param}' điều khiển đích chuyển hướng: khi tiêm {PAYLOAD}, máy chủ trả về HTTP {status} với Location trỏ ra domain ngoài ({location[:80]}).",
                recommendation="Chỉ cho phép chuyển hướng tới danh sách đích nội bộ (allowlist); không chuyển hướng theo URL tuyệt đối do người dùng cung cấp."))
    return findings
