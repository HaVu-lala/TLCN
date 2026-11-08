"""[Kịch bản 2 - TN2] A05:2025 Injection - Cross-Site Scripting (XSS).

Ba ngữ cảnh XSS, ba vị trí code:
  * Reflected XSS (trình duyệt thật): oracle Chromium trong app/browser_xss.py.
    Đăng ký làm detector thường trực -> Tool 4 tự xác minh trên mọi GET param
    thu thập được (script có THỰC THI hay không, không chỉ phản chiếu chuỗi).
  * Stored / DOM XSS trên lab: app/labs.py (check_lab) chạy theo kế hoạch của AI.
  * Reflected / Stored XSS kiểu phản chiếu HTML tĩnh: oracle trong
    app/agent.py VerificationAgent.run (kind == "reflected_xss"/"stored_xss")
    trên đường Tool 3 probe_and_verify.
"""
from app.browser_xss import browser_reflected_xss
from app.detectors import DetectorContext, register
from app.stored_xss import stored_xss_blackbox


@register("A05 reflected XSS (browser oracle)")
def reflected_xss(ctx: DetectorContext):
    return browser_reflected_xss(ctx.tools, ctx.pages)


@register("A05 stored XSS (black-box seed-and-revisit, active mode)")
def stored_xss(ctx: DetectorContext):
    # Oracle hộp đen tổng quát; chỉ chạy khi settings.aggressive_scan = True.
    return stored_xss_blackbox(ctx.tools, ctx.pages)
