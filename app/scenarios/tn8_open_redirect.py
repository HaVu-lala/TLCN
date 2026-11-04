"""[Kịch bản 8 - TN8] Open Redirect - kiểm thử chủ động, oracle sạch.

Tiêm URL ngoài vào tham số đích chuyển hướng, soi header Location (3xx) để kết
luận. Logic ở app/open_redirect.py. Finding "Open Redirect" được tính như một
phát hiện bình thường (oracle nhị phân, giữ FPR=0).
"""
from app.detectors import DetectorContext, register
from app.labs import lab_open_redirect_checks
from app.open_redirect import check_open_redirect


@register("Open Redirect (active, Location oracle)")
def open_redirect(ctx: DetectorContext):
    return check_open_redirect(ctx.tools, ctx.pages)


@register("Open Redirect (lab-pinned)")
def open_redirect_lab(ctx: DetectorContext):
    return lab_open_redirect_checks(ctx.tools, ctx.pages)
