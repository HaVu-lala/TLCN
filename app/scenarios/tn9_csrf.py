"""[Kịch bản 9 - TN9] CSRF - mức nghi ngờ (low confidence).

Heuristic: biểu mẫu POST không có token chống CSRF thì đáng ngờ. Logic ở
app/csrf.py. Finding "Potential CSRF" gắn nhãn nghi ngờ, severity thấp, và nằm
NGOÀI tập category chấm điểm (app/evaluation.py) nên không ảnh hưởng FPR/metric.
"""
from app.csrf import check_csrf
from app.detectors import DetectorContext, register


@register("Potential CSRF (heuristic, low confidence)")
def csrf(ctx: DetectorContext):
    return check_csrf(ctx.tools, ctx.pages)
