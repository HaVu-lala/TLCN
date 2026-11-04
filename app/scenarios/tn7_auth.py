"""[Kịch bản 7 - TN7] A07:2025 Authentication Failures.

  * Trên form đăng nhập phát hiện được: thử tập nhỏ credential mặc định và một
    loạt đăng nhập sai để xem có khóa/giới hạn không -> app/auth_checks.py
    (check_authentication).
  * Trên ứng dụng lab: đăng nhập sai liên tiếp ở REST/login không bị khóa
    -> app/labs.py (lab_auth_failure_checks).
"""
from app.auth_checks import check_authentication
from app.detectors import DetectorContext, register
from app.labs import lab_auth_failure_checks


@register("A07 authentication weaknesses")
def authentication(ctx: DetectorContext):
    return check_authentication(ctx.tools, ctx.pages)


@register("A07 authentication failures (lab)")
def authentication_lab(ctx: DetectorContext):
    return lab_auth_failure_checks(ctx.tools, ctx.pages)
