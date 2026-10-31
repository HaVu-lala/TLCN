"""Detector OWASP A01:2025 - Broken Access Control (cấp chức năng / BFLA).

Kiểm tra forced-browsing: truy cập các endpoint quản trị bằng phiên làm việc
hiện tại (ẩn danh hoặc người dùng thường). Nếu một endpoint rõ ràng mang tính
quản trị trả về HTTP 200 kèm dữ liệu JSON thực (không phải lỗi/đăng nhập), nghĩa
là máy chủ không kiểm tra quyền cấp chức năng. Oracle yêu cầu dữ liệu JSON hợp lệ
và không chứa dấu hiệu lỗi/đăng nhập để giữ tỷ lệ báo động giả thấp.
"""
import json
from urllib.parse import urlparse

from app.schemas import Finding

# Danh sách endpoint quản trị phổ biến (forced-browsing), kiểu DAST.
PRIVILEGED_PATHS = [
    "/api/admin/dashboard", "/api/admin/users", "/api/admin/orders",
    "/api/admin/products", "/api/admin/promotions", "/api/admin/commissions",
    "/api/admin/shippers", "/actuator/env",
]
ERROR_TOKENS = ("unauthorized", "forbidden", "access denied", "please log in",
                "đăng nhập", "invalid action", "not found", "\"error\"")


def _origin(url: str) -> str:
    p = urlparse(url)
    return f"{p.scheme}://{p.netloc}"


def check_access_control(tools, pages: list[dict]) -> list[Finding]:
    base = _origin(tools.target_url)
    candidates = list(PRIVILEGED_PATHS)
    # Bổ sung các endpoint quản trị phát hiện được trong quá trình thu thập.
    for page in pages:
        for endpoint in page.get("endpoints", []):
            if endpoint.get("method", "GET").upper() != "GET":
                continue
            path = urlparse(endpoint.get("url", "")).path
            if "admin" in path.lower() and path not in candidates:
                candidates.append(path)

    findings: list[Finding] = []
    seen: set[str] = set()
    for path in candidates:
        if path in seen:
            continue
        seen.add(path)
        response = tools.request(base + path)
        if response.get("status") != 200:
            continue
        content_type = response.get("headers", {}).get("content-type", "")
        body = (response.get("body") or "").strip()
        if "json" not in content_type or not body.startswith(("{", "[")):
            continue
        if len(body) < 30 or any(token in body.lower() for token in ERROR_TOKENS):
            continue
        try:
            parsed = json.loads(body)
        except ValueError:
            continue
        # JSON rỗng hoặc chỉ chứa cờ lỗi thì bỏ qua.
        if isinstance(parsed, dict) and (parsed.get("success") is False or parsed.get("error")):
            continue
        findings.append(Finding(
            category="Broken Access Control", severity="high", url=base + path, parameter=None,
            evidence=f"Endpoint quản trị {path} trả về HTTP 200 kèm dữ liệu JSON cho một phiên không phải quản trị viên (thiếu kiểm tra quyền cấp chức năng).",
            recommendation="Thực thi kiểm tra vai trò ở phía máy chủ (function-level authorization) cho mọi endpoint quản trị."))
    return findings
