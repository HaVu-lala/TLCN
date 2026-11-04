"""[Kịch bản 4 - TN4] Kiểm tra thụ động phản hồi (gộp A02 + A03 + A04).

Gộp ba nhóm CÙNG MỘT CƠ CHẾ: chỉ đọc phản hồi máy chủ đã trả về, không gửi
payload phá dữ liệu. Việc gộp là gộp VỀ MẶT TỔ CHỨC CODE (một điểm đăng ký),
mỗi nhóm vẫn sinh một loại Finding riêng với bằng chứng riêng, nên không mất
phân loại OWASP khi lập báo cáo:

  * A02 Security Misconfiguration : thiếu security header, lộ stack trace
        -> app/passive.py  _a02  (passive_findings gọi tới)
  * A03 Software Supply Chain      : header lộ phiên bản thành phần (đối chiếu CVE)
        -> app/passive.py  _a03
  * A04 Cryptographic Failures     : cookie thiếu HttpOnly/Secure/SameSite, thiếu HSTS
        -> app/passive.py  _a04

Phần kiểm tra cấu hình trên ứng dụng lab (lộ /ftp, /actuator/env) cùng nhóm A02
nên gom chung ở đây -> app/labs.py  lab_misconfig_checks.
"""
from app.detectors import DetectorContext, register
from app.labs import lab_misconfig_checks
from app.passive import passive_findings


@register("A02/A03/A04 passive response audit")
def passive_audit(ctx: DetectorContext):
    # passive_findings trả về cả 3 nhóm A02/A03/A04, mỗi nhóm một category riêng.
    return passive_findings(ctx.pages, ctx.tools.target_url)


@register("A02 security misconfiguration (lab)")
def misconfig_lab(ctx: DetectorContext):
    return lab_misconfig_checks(ctx.tools, ctx.pages)
