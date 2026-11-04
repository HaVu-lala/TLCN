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

File này là ĐIỂM NEO tài liệu cho TN1. Nó không đăng ký detector thường trực để
giữ nguyên hành vi: SQLi chỉ được thăm dò khi AI/kế hoạch chủ động chọn tham số,
nhờ đó giữ tỷ lệ báo động giả bằng 0.
"""
# Không import gì ở mức module để tránh vòng import với app.agent.
# Logic TN1 nằm ở các vị trí được chỉ ra trong docstring ở trên.
