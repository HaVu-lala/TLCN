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


def _companions(form: dict, exclude: str) -> dict:
    """Các trường khác của form, điền giá trị lành tính để không bị chặn bởi kiểm tra trường bắt buộc."""
    return {i["name"]: (i.get("value") or "sentinel-fill")
            for i in form.get("inputs", []) if i.get("name") and i.get("name") != exclude}


def _candidates(pages: list[dict]) -> list[tuple[str, str, str, dict]]:
    """Thu các (url, tham_số, method, companions) có tên giống đích chuyển hướng."""
    raw: list[tuple[str, str, str, dict]] = []
    for page in pages:
        for endpoint in page.get("endpoints", []):
            if endpoint.get("method", "GET").upper() != "GET":
                continue
            for param in endpoint.get("parameters", []):
                if (param or "").lower() in REDIRECT_PARAM_NAMES:
                    raw.append((endpoint.get("url", ""), param, "GET", {}))
        for form in page.get("forms", []):
            method = form.get("method", "GET").upper()
            for item in form.get("inputs", []):
                name = item.get("name") or ""
                if name.lower() in REDIRECT_PARAM_NAMES:
                    raw.append((form.get("action", ""), name, method, _companions(form, name)))
    # Khử trùng theo (url, tham số, method); khi trùng, ưu tiên bản có companion fields
    # (thường là form) để không bỏ sót trường bắt buộc.
    by_triple: dict[tuple[str, str, str], tuple[str, str, str, dict]] = {}
    for target in raw:
        key = target[:3]
        if key not in by_triple or (not by_triple[key][3] and target[3]):
            by_triple[key] = target
    targets = list(by_triple.values())
    # Mỗi cặp (url, tham số) được ưu tiên một suất; method khác dùng phần hạn mức còn lại.
    primary: dict[tuple[str, str], tuple[str, str, str, dict]] = {}
    for target in targets:
        key = target[:2]
        if key not in primary or (not primary[key][3] and target[3]):
            primary[key] = target
    extras = [target for target in targets if target[:3] not in {t[:3] for t in primary.values()}]
    return (list(primary.values()) + extras)[:MAX_TARGETS]


# [TN8 - Open Redirect] Tiêm URL ngoài vào tham số đích, kết luận qua header Location 3xx.
def check_open_redirect(tools, pages: list[dict]) -> list[Finding]:
    findings: list[Finding] = []
    seen: set[tuple] = set()
    for url, param, method, companions in _candidates(pages):
        if not url:
            continue
        response = tools.request(
            url, method,
            params={**companions, param: PAYLOAD} if method == "GET" else None,
            data={**companions, param: PAYLOAD} if method != "GET" else None,
            follow_redirects=False,
        )
        status = response.get("status", 0)
        if not (300 <= status < 400):
            continue
        location = response.get("headers", {}).get("location", "")
        # Oracle: Location phải trỏ đúng ra domain ngoài mình đã tiêm.
        if urlparse(location).hostname == PAYLOAD_HOST:
            key = ("Open Redirect", url, param)
            if key in seen:
                continue
            seen.add(key)
            findings.append(Finding(
                category="Open Redirect", severity="medium", url=url, parameter=param,
                evidence=f"Tham số '{param}' điều khiển đích chuyển hướng: khi tiêm {PAYLOAD}, máy chủ trả về HTTP {status} với Location trỏ ra domain ngoài ({location[:80]}).",
                recommendation="Chỉ cho phép chuyển hướng tới danh sách đích nội bộ (allowlist); không chuyển hướng theo URL tuyệt đối do người dùng cung cấp."))
    return findings
