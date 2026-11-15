"""Kiểm tra điểm yếu xác thực (OWASP A07:2025) - có giới hạn, chỉ cho lab.

Các phép kiểm cố tình thận trọng: thử một danh sách NHỎ, cố định các cặp thông tin
đăng nhập mặc định trên form login phát hiện được, cộng với một loạt đăng nhập sai
có giới hạn để quan sát xem ứng dụng có áp giới hạn tần suất / khóa tài khoản không.
Không tạo hay sửa tài khoản nào và số request bị chặn trần.
"""
from bs4 import BeautifulSoup

from app.schemas import Finding

# Danh sách credential mặc định rất phổ biến. Cố ý giữ ngắn.
DEFAULT_CREDENTIALS = [("admin", "admin"), ("admin", "password"), ("administrator", "administrator")]

SUCCESS_TOKENS = ("\"status\":\"ok\"", "\"status\": \"ok\"", "authentication", "\"token\"", "set-cookie", "welcome", "success", "logout")
FAILURE_TOKENS = ("invalid", "incorrect", "error", "failed", "denied", "unauthorized")
LOCKOUT_STATUS = {429, 423}
INCONCLUSIVE_STATUS = {404, 405}
# 400/403/422 có thể đến từ WAF, CSRF hoặc kiểm tra hợp lệ chạy TRƯỚC khi mật khẩu được xét.
AMBIGUOUS_STATUS = {400, 403, 422}
CREDENTIAL_REJECTION_TOKENS = (
    "invalid password", "invalid credentials", "invalid username", "invalid login",
    "incorrect", "wrong password", "wrong username", "login failed", "authentication failed",
    "bad credentials", "sai mật khẩu", "mật khẩu sai", "mật khẩu không đúng",
    "đăng nhập thất bại", "thông tin đăng nhập không",
)
PRE_AUTH_BLOCK_TOKENS = ("csrf", "xsrf", "captcha", "waf", "blocked", "bị chặn")
# Áp ở mọi status, nên đây là thông điệp đầy đủ: một trang login có thể có field CSRF ẩn
# hoặc widget captcha mà vẫn đã xét thông tin đăng nhập.
PRE_AUTH_CHALLENGE_PHRASES = (
    "invalid csrf", "csrf token missing", "csrf token expired", "csrf token mismatch",
    "missing csrf", "expired csrf", "csrf verification failed", "csrf validation failed",
    "invalid xsrf", "missing xsrf", "complete the captcha", "solve the captcha",
    "captcha required", "captcha failed", "invalid captcha", "incorrect captcha",
    "wrong captcha", "verify you are human", "vui lòng nhập captcha", "sai captcha",
    "mã captcha không đúng", "xác minh bạn không phải",
)
LOCKOUT_TOKENS = ("locked", "too many", "rate limit", "try again later", "temporarily")

MAX_LOGIN_FORMS = 2
# Lần đăng nhập sai baseline cộng với số lần khóa này tạo thành loạt đăng nhập sai
# làm bằng chứng (1 + 9 = 10 lần thất bại liên tiếp trước khi kết luận không khóa).
MAX_LOCKOUT_ATTEMPTS = 9


def _field(inputs: list[dict], predicate) -> str | None:
    """Trả về tên input đầu tiên thỏa ``predicate`` (hoặc None nếu không có)."""
    return next((item["name"] for item in inputs if item.get("name") and predicate(item)), None)


def find_login_forms(pages: list[dict]) -> list[dict]:
    """Tìm các form đăng nhập (có cả trường mật khẩu và trường user/email/login)."""
    forms: list[dict] = []
    for page in pages:
        for form in page.get("forms", []):
            inputs = form.get("inputs", [])
            password_field = _field(inputs, lambda i: i.get("type") == "password" or "pass" in (i.get("name") or "").lower())
            user_field = _field(inputs, lambda i: "pass" not in (i.get("name") or "").lower()
                                and any(key in (i.get("name") or "").lower() for key in ("user", "email", "login", "name")))
            if password_field and user_field:
                forms.append({**form, "_user_field": user_field, "_password_field": password_field})
    return forms


def _login_succeeded(response: dict) -> bool:
    """Phỏng đoán đăng nhập thành công: status 2xx/302, không có dấu hiệu lỗi, có token thành công hoặc set-cookie."""
    if response["status"] not in (200, 201, 302) or _hit_challenge(response):
        return False
    body = response.get("body", "").lower()
    if any(token in body for token in FAILURE_TOKENS):
        return False
    header_blob = " ".join(f"{k}:{v}" for k, v in response.get("headers", {}).items()).lower()
    return any(token in body for token in SUCCESS_TOKENS) or "set-cookie" in header_blob


def _is_locked(response: dict) -> bool:
    """True nếu phản hồi cho thấy bị khóa / giới hạn tần suất (status 429/423 hoặc văn bản báo khóa)."""
    if response["status"] in LOCKOUT_STATUS:
        return True
    text = _visible_text(response)
    return any(token in text for token in LOCKOUT_TOKENS)


def _limiter_engaged(history: list[dict]) -> bool:
    """True khi có tín hiệu khóa, hoặc chuyển sang 403 giữa chừng (khác với một lần bị từ chối)."""
    turned_forbidden = any(current["status"] == 403 and previous["status"] != 403
                           for previous, current in zip(history, history[1:]))
    return turned_forbidden or any(_is_locked(response) for response in history)


def _visible_text(response: dict) -> str:
    """Văn bản người dùng thực sự đọc (viết thường, bỏ markup/script/field ẩn)."""
    body = response.get("body", "")
    if "<" in body:
        soup = BeautifulSoup(body, "html.parser")
        for element in soup(["script", "style", "noscript", "template"]):
            element.decompose()
        body = soup.get_text(" ")
    return " ".join(body.lower().split())


def _hit_challenge(response: dict) -> bool:
    """True nếu phản hồi chứa thử thách tiền-xác thực (CSRF/captcha) khiến kết quả login không rõ."""
    text = _visible_text(response)
    return any(phrase in text for phrase in PRE_AUTH_CHALLENGE_PHRASES)


def _login_was_processed(response: dict) -> bool:
    """False trừ khi phản hồi cho thấy trình xử lý login đã thực sự xét thông tin đăng nhập.

    Dùng để chắc chắn đang quan sát đúng một endpoint xác thực (loại 5xx, 404/405,
    thử thách CSRF/captcha, và các status mơ hồ không kèm thông điệp từ chối rõ ràng).
    """
    status = response["status"]
    if status == 0 or status >= 500 or status in INCONCLUSIVE_STATUS:
        return False
    if _hit_challenge(response):
        return False
    if status not in AMBIGUOUS_STATUS:
        return True
    text = _visible_text(response)
    if any(token in text for token in PRE_AUTH_BLOCK_TOKENS):
        return False
    return any(token in text for token in CREDENTIAL_REJECTION_TOKENS)


# [TN7 - A07 Authentication Failures] Oracle hộp đen tổng quát: thử credential mặc định + loạt đăng nhập sai (tới 10 lần) xem có khóa/giới hạn không.
def check_authentication(tools, pages: list[dict]) -> list[Finding]:
    """Kiểm điểm yếu xác thực trên các form login; khôi phục cookie jar để không đổi danh tính phiên quét.

    Một lần đăng nhập mặc định thành công sẽ đặt cookie phiên trên client dùng chung;
    hàm chụp lại và khôi phục toàn bộ cookie jar (giữ nguyên name, domain, path, cờ)
    để các detector sau giữ đúng danh tính ban đầu thay vì thừa hưởng phiên admin do
    chính phép kiểm này tạo ra.
    """
    findings: list[Finding] = []
    jar = getattr(getattr(tools, "client", None), "cookies", None)
    saved_cookies = list(jar.jar) if jar is not None else None
    try:
        _run_auth_checks(tools, pages, findings)
    finally:
        if jar is not None and saved_cookies is not None:
            jar.jar.clear()
            for cookie in saved_cookies:
                jar.jar.set_cookie(cookie)

    unique: dict[tuple, Finding] = {}
    for finding in findings:
        unique.setdefault((finding.category, finding.url, finding.parameter), finding)
    return list(unique.values())


def _run_auth_checks(tools, pages: list[dict], findings: list[Finding]) -> None:
    """Chạy phép kiểm A07 trên tối đa ``MAX_LOGIN_FORMS`` form login, ghi phát hiện vào ``findings``.

    Với mỗi form: (1) thử các cặp credential mặc định - nếu một cặp được chấp nhận
    trong khi credential sai bị từ chối thì báo lỗi credential mặc định; (2) gửi một
    loạt đăng nhập sai liên tiếp - nếu không hề bị khóa/giới hạn thì báo thiếu cơ chế
    chống dò mật khẩu.
    """
    for form in find_login_forms(pages)[:MAX_LOGIN_FORMS]:
        action = form["action"]
        method = form.get("method", "POST")
        user_field = form["_user_field"]
        password_field = form["_password_field"]

        def attempt(username: str, password: str) -> dict:
            # Điền đủ các trường của form rồi ghi đè user/password để chạm đúng trình xử lý login.
            data = {item["name"]: item.get("value", "") for item in form.get("inputs", []) if item.get("name")}
            data[user_field] = username
            data[password_field] = password
            return tools.request(action, method, params=data if method == "GET" else None,
                                 data=data if method != "GET" else None)

        invalid = attempt("sentinel-unknown-user", "sentinel-wrong-password")
        history = [invalid]

        # (1) Thử credential mặc định.
        for username, password in DEFAULT_CREDENTIALS:
            trial = attempt(username, password)
            history.append(trial)
            if _login_succeeded(trial) and not _login_succeeded(invalid):
                findings.append(Finding(
                    category="Authentication Failures", severity="high", url=action, parameter=password_field,
                    evidence=f"Default credentials {username}/{password} were accepted while an invalid credential was rejected. Only the tested pair is retained.",
                    recommendation="Remove default accounts and enforce a strong, unique password policy.",
                ))
                break

        # (2) Loạt đăng nhập sai để quan sát khóa/giới hạn tần suất.
        responses = [invalid]
        locked = _limiter_engaged(history)
        for _ in range(MAX_LOCKOUT_ATTEMPTS):
            response = attempt("sentinel-lockout-user", "sentinel-wrong-password")
            responses.append(response)
            history.append(response)
            if _limiter_engaged(history):
                locked = True
                break
        statuses = [response["status"] for response in responses]
        if not locked and all(_login_was_processed(response) for response in responses):
            findings.append(Finding(
                category="Authentication Failures", severity="medium", url=action, parameter=password_field,
                evidence=f"{len(statuses)} consecutive failed logins did not trigger any lockout or rate limiting (observed statuses {statuses}).",
                recommendation="Apply account lockout, exponential backoff or CAPTCHA after repeated authentication failures.",
            ))
