"""[Kịch bản 1 - TN1] A05:2025 Injection - SQL Injection.

Khác các kịch bản còn lại, TN1 KHÔNG chạy trong bộ detector thường trực (Tool 4),
mà nằm trên đường kiểm thử CHỦ ĐỘNG vì cần AI quyết định tham số nào đáng thăm dò:

  1. GỬI payload:
       - Tool 3 probe_and_verify  -> app/toolbox.py (ToolBox.probe_and_verify)
       - hoặc AttackAgent.run      -> app/agent.py
     Với mỗi tham số: một yêu cầu baseline lành tính và một yêu cầu mang dấu nháy
     đơn ('). Payload chỉ là dấu nháy, KHÔNG phá dữ liệu.

  2. KẾT LUẬN (oracle HAI NHÁNH) -> app/agent.py  VerificationAgent.run,
     nhánh kind == "basic_sqli":
       (a) chữ ký lỗi SQL xuất hiện khi tiêm mà baseline không có; HOẶC
       (b) dấu nháy đơn gây HTTP 5xx trong khi baseline không 5xx.

  3. Oracle chuyên biệt cho ứng dụng lab -> app/labs.py  check_lab,
     nhánh "basic_sqli" (Juice Shop /rest/products/search, WebGoat attack8).

File này là ĐIỂM NEO tài liệu cho TN1. Phần thăm dò chính (dấu nháy trên form và
tham số GET) vẫn do AI/kế hoạch chủ động chọn, giữ tỷ lệ báo động giả bằng 0.

NGOÀI RA, file đăng ký MỘT detector thường trực "known-endpoint probing": kiểm
SQLi trên vài endpoint API đã biết chỉ truy cập được sau đăng nhập và được gọi
bằng JavaScript (SPA) nên crawler không tự lần ra - ví dụ endpoint đổi mật khẩu.
Đây là kỹ thuật DAST có danh sách (giống forced-browsing trong app/access_control.py).
Oracle vẫn là VerificationAgent (nhánh basic_sqli), không hạ chuẩn báo động giả:
không có phiên hợp lệ thì baseline/inject thường cùng bị chặn quyền -> không 5xx
-> không báo.
"""
from urllib.parse import urlparse

from app.detectors import DetectorContext, register

# Endpoint API đã biết cần kiểm SQLi bằng thân JSON. Mỗi mục:
#   path         - đường dẫn tương đối trên origin mục tiêu
#   method       - HTTP method
#   inject_field - trường JSON sẽ tiêm dấu nháy đơn
#   fields       - toàn bộ trường bắt buộc + giá trị hợp lệ để vượt kiểm tra phía
#                  trước (vd newPassword == confirmPassword) và chạm tới câu SQL
KNOWN_JSON_SQLI_ENDPOINTS = [
    {
        "path": "/api/profile/password",
        "method": "POST",
        "inject_field": "currentPassword",
        "fields": {
            "currentPassword": "",
            "newPassword": "Newpass@123",
            "confirmPassword": "Newpass@123",
        },
    },
]


@register("A05 SQLi trên endpoint API đã biết (seeded, cần phiên đăng nhập)")
def seeded_json_sqli(ctx: DetectorContext):
    """Thăm dò SQLi trên các endpoint trong KNOWN_JSON_SQLI_ENDPOINTS.

    Bổ khuyết cho crawler: endpoint nằm sau đăng nhập, gọi bằng JS nên không có
    trong pages. Với mỗi endpoint: một yêu cầu baseline lành tính và một yêu cầu
    mang dấu nháy đơn, rồi để VerificationAgent kết luận bằng cùng oracle hai nhánh.
    """
    from app.agent import AttackProbe, VerificationAgent

    parsed = urlparse(ctx.tools.target_url)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    probes: list = []
    for spec in KNOWN_JSON_SQLI_ENDPOINTS:
        url = origin + spec["path"]
        field = spec["inject_field"]
        baseline_body = {**spec["fields"], field: "sentinel-baseline"}
        inject_body = {**spec["fields"], field: "'"}
        try:
            baseline = ctx.tools.request(url, spec["method"], json_body=baseline_body)
            result = ctx.tools.request(url, spec["method"], json_body=inject_body)
        except Exception:  # noqa: BLE001 - một endpoint lỗi không được chặn cả battery
            continue
        probes.append(AttackProbe(
            "basic_sqli", result["url"], field, result["body"], result["status"],
            baseline["body"], baseline_status=baseline["status"]))
    return VerificationAgent().run(probes)
