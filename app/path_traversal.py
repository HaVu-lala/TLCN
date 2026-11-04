"""Detector Path Traversal (duyệt thư mục) - kiểm thử CHỦ ĐỘNG, oracle sạch.

Với mỗi tham số trông giống tên tệp/đường dẫn, tiêm chuỗi duyệt ngược để cố đọc
một tệp hệ thống đã biết (/etc/passwd) và so với một yêu cầu baseline lành tính.

Oracle chỉ công nhận khi chữ ký /etc/passwd (root:...:0:0:) xuất hiện ở phản hồi
tiêm mà baseline không có. Đây là bằng chứng đọc được tệp ngoài phạm vi, không phá
dữ liệu, nên tỷ lệ báo động giả ~0.
"""
import re
from app.schemas import Finding

# Tên tham số thường mang đường dẫn/tên tệp.
FILE_PARAM_NAMES = {
    "file", "page", "path", "doc", "document", "template", "filename",
    "include", "load", "read", "download", "view", "dir", "folder", "pg", "item",
}
# Chữ ký nội dung /etc/passwd trên hệ thống Unix.
PASSWD_SIG = re.compile(r"root:.*:0:0:")
PAYLOADS = [
    "../../../../../../etc/passwd",
    "....//....//....//....//....//etc/passwd",
    "..%2f..%2f..%2f..%2f..%2f..%2fetc%2fpasswd",
]
BENIGN = "sentinel-benign"
MAX_TARGETS = 10


def _candidates(pages: list[dict]) -> list[tuple[str, str, str]]:
    targets: list[tuple[str, str, str]] = []
    seen: set[tuple[str, str]] = set()
    for page in pages:
        for endpoint in page.get("endpoints", []):
            if endpoint.get("method", "GET").upper() != "GET":
                continue
            for param in endpoint.get("parameters", []):
                if (param or "").lower() in FILE_PARAM_NAMES:
                    key = (endpoint.get("url", ""), param)
                    if key not in seen:
                        seen.add(key)
                        targets.append((endpoint.get("url", ""), param, "GET"))
        for form in page.get("forms", []):
            method = form.get("method", "GET").upper()
            for item in form.get("inputs", []):
                name = item.get("name") or ""
                if name.lower() in FILE_PARAM_NAMES:
                    key = (form.get("action", ""), name)
                    if key not in seen:
                        seen.add(key)
                        targets.append((form.get("action", ""), name, method))
    return targets[:MAX_TARGETS]


def check_path_traversal(tools, pages: list[dict]) -> list[Finding]:
    findings: list[Finding] = []
    seen: set[tuple] = set()
    for url, param, method in _candidates(pages):
        if not url:
            continue
        baseline = tools.request(url, method,
                                 params={param: BENIGN} if method == "GET" else None,
                                 data={param: BENIGN} if method != "GET" else None)
        if PASSWD_SIG.search(baseline.get("body", "") or ""):
            continue  # baseline đã chứa chữ ký -> không kết luận được
        for payload in PAYLOADS:
            injected = tools.request(url, method,
                                     params={param: payload} if method == "GET" else None,
                                     data={param: payload} if method != "GET" else None)
            if injected.get("status", 0) >= 500:
                continue
            if PASSWD_SIG.search(injected.get("body", "") or ""):
                key = ("Path Traversal", url, param)
                if key in seen:
                    break
                seen.add(key)
                findings.append(Finding(
                    category="Path Traversal", severity="high", url=url, parameter=param,
                    evidence=f"Tham số '{param}' cho phép duyệt thư mục: payload {payload[:40]} khiến phản hồi chứa nội dung /etc/passwd (chữ ký root:...:0:0:) trong khi đầu vào lành tính thì không.",
                    recommendation="Chuẩn hóa và kiểm tra đường dẫn (canonicalize), chỉ cho phép truy cập trong thư mục quy định; không ghép trực tiếp đầu vào vào đường dẫn tệp."))
                break
    return findings
