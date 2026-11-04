"""Gói kịch bản thực nghiệm: mỗi file là MỘT kịch bản.

Bản đồ file - kịch bản - nhóm OWASP Top 10:2025:
    tn1_sql_injection.py   TN1  A05 Injection (SQL Injection)
    tn2_xss.py             TN2  A05 Injection (XSS phản chiếu / lưu trữ / DOM)
    tn3_access_control.py  TN3  A01 Broken Access Control (forced-browse + BOLA/IDOR)
    tn4_passive_audit.py   TN4  A02 + A03 + A04 (kiểm tra thụ động phản hồi, đã gộp)
    tn7_auth.py            TN7  A07 Authentication Failures
    tn8_open_redirect.py   TN8  Open Redirect (chủ động, oracle Location)
    tn9_csrf.py            TN9  Potential CSRF (heuristic, nghi ngờ - low confidence)
    tn10_path_traversal.py TN10 Path Traversal (chủ động + ghim lab Juice Shop)
    tn11_xxe.py            TN11 XXE (chủ động + ghim lab Juice Shop)

Import toàn bộ để các @register trong từng file ghi detector vào registry
(app/detectors.py). Thứ tự import quyết định thứ tự chạy trong Tool 4 / run_all.
TN1 không đăng ký detector thường trực (xem docstring tn1_sql_injection).
"""
from app.scenarios import (  # noqa: F401
    tn1_sql_injection,
    tn2_xss,
    tn3_access_control,
    tn4_passive_audit,
    tn7_auth,
    tn8_open_redirect,
    tn9_csrf,
    tn10_path_traversal,
    tn11_xxe,
)
