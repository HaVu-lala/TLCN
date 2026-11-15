"""[Kịch bản 11 - TN11] XXE (XML External Entity).

- Generic: với endpoint nhận XML, gửi payload khai báo thực thể ngoài trỏ
  /etc/passwd, oracle kiểm chữ ký. Logic ở app/xxe.py.
- Ghim theo lab: Juice Shop /file-upload nạp XML có thực thể ngoài. app/labs.py.
"""
from app.detectors import DetectorContext, register
from app.labs import lab_xxe_checks
from app.xxe import check_xxe


@register("XXE (active, external-entity oracle)")
def xxe(ctx: DetectorContext):
    """XXE tổng quát: endpoint nhận XML, tiêm thực thể ngoài trỏ /etc/passwd, oracle kiểm chữ ký."""
    return check_xxe(ctx.tools, ctx.pages)


@register("XXE (lab-pinned)")
def xxe_lab(ctx: DetectorContext):
    """XXE ghim theo lab (Juice Shop /file-upload, WebGoat /xxe/simple)."""
    return lab_xxe_checks(ctx.tools, ctx.pages)
