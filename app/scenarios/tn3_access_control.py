"""[Kịch bản 3 - TN3] A01:2025 Broken Access Control.

Hai hướng kiểm tra, cùng thuộc A01:
  * Forced-browsing cấp chức năng (BFLA): truy cập các endpoint quản trị bằng
    phiên hiện tại. Oracle trong app/access_control.py (check_access_control).
  * BOLA/IDOR hai phiên: so sánh cùng một đối tượng giữa hai người dùng, dùng
    oracle của VerificationAgent (app/agent.py). Chỉ chạy khi có phiên so sánh.
"""
from app.access_control import check_access_control
from app.detectors import DetectorContext, register


@register("A01 broken access control (forced browsing)")
def forced_browsing(ctx: DetectorContext):
    return check_access_control(ctx.tools, ctx.pages)


@register("A01 BOLA/IDOR (two sessions)")
def bola_two_session(ctx: DetectorContext):
    if not ctx.comparison_tools:
        return []
    # Import trễ để tránh vòng import với app.agent.
    from app.agent import AttackProbe, VerificationAgent
    target = ctx.tools.target_url.rstrip("/") + "/object"
    owner = ctx.tools.request(target, params={"id": "1"})
    other = ctx.comparison_tools.request(target, params={"id": "1"})
    probe = AttackProbe("idor", other["url"], "id", other["body"], other["status"],
                        owner["body"], baseline_status=owner["status"])
    return VerificationAgent().run([probe])
