"""Detector CSRF (Cross-Site Request Forgery) - mức NGHI NGỜ, độ tin thấp.

Khác các detector khác, CSRF KHÔNG có oracle chắc chắn trong kiến trúc chỉ-đọc,
không-phá-dữ-liệu: xác nhận CSRF thật phải thực sự gửi yêu cầu đổi trạng thái từ
một nguồn khác và kiểm tra nó thành công, vừa phá dữ liệu vừa khó tin cậy.

Vì vậy đây chỉ là HEURISTIC nghi ngờ: một biểu mẫu POST (đổi trạng thái) mà không
có trường token chống CSRF thì ĐÁNG NGỜ. Nhiều ứng dụng chống CSRF bằng SameSite
cookie hoặc header tùy biến (không dùng token form), nên thiếu token KHÔNG chắc là
lỗ hổng. Do đó finding gắn nhãn "Potential CSRF", severity thấp, và category này
nằm NGOÀI tập category chấm điểm (app/evaluation.py) để không ảnh hưởng FPR/metric.
"""
from app.schemas import Finding

# Tên trường thường dùng cho token chống CSRF.
TOKEN_HINTS = ("csrf", "xsrf", "_token", "authenticity_token", "nonce",
               "__requestverificationtoken", "anti-forgery", "antiforgery")


def check_csrf(tools, pages: list[dict]) -> list[Finding]:
    findings: list[Finding] = []
    seen: set[str] = set()
    for page in pages:
        for form in page.get("forms", []):
            if form.get("method", "GET").upper() != "POST":
                continue  # chỉ xét biểu mẫu POST (đổi trạng thái)
            action = form.get("action", "")
            if not action or action in seen:
                continue
            inputs = form.get("inputs", [])
            has_token = any(
                any(hint in (item.get("name") or "").lower() for hint in TOKEN_HINTS)
                for item in inputs
            )
            if has_token:
                continue
            seen.add(action)
            findings.append(Finding(
                category="Potential CSRF", severity="low", url=action, parameter=None,
                evidence="Biểu mẫu POST (đổi trạng thái) không có trường token chống CSRF. Đây là dấu hiệu NGHI NGỜ, chưa khai thác thực tế và chưa loại trừ khả năng ứng dụng chống bằng SameSite cookie hoặc header tùy biến.",
                recommendation="Thêm anti-CSRF token cho mọi yêu cầu đổi trạng thái, và/hoặc đặt SameSite cho cookie phiên."))
    return findings
