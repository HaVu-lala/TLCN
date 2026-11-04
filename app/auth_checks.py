"""Bounded, lab-only authentication-weakness checks (OWASP A07:2025).

The checks are deliberately conservative: a fixed, tiny set of default
credential pairs is tried against a detected login form, plus a bounded burst
of invalid logins to observe whether any rate limiting or lockout is applied.
No accounts are created or modified and the number of requests is capped.
"""
from bs4 import BeautifulSoup

from app.schemas import Finding

# A minimal, well-known default-credential list. Kept short on purpose.
DEFAULT_CREDENTIALS = [("admin", "admin"), ("admin", "password"), ("administrator", "administrator")]

SUCCESS_TOKENS = ("\"status\":\"ok\"", "\"status\": \"ok\"", "authentication", "\"token\"", "set-cookie", "welcome", "success", "logout")
FAILURE_TOKENS = ("invalid", "incorrect", "error", "failed", "denied", "unauthorized")
LOCKOUT_STATUS = {429, 423}
INCONCLUSIVE_STATUS = {404, 405}
# 400/403/422 may come from a WAF, CSRF or validation check that ran before the password was judged.
AMBIGUOUS_STATUS = {400, 403, 422}
CREDENTIAL_REJECTION_TOKENS = (
    "invalid password", "invalid credentials", "invalid username", "invalid login",
    "incorrect", "wrong password", "wrong username", "login failed", "authentication failed",
    "bad credentials", "sai mật khẩu", "mật khẩu sai", "mật khẩu không đúng",
    "đăng nhập thất bại", "thông tin đăng nhập không",
)
PRE_AUTH_BLOCK_TOKENS = ("csrf", "xsrf", "captcha", "waf", "blocked", "bị chặn")
# Applied at every status, so these are full messages: a login page may carry a hidden
# CSRF field or a captcha widget and still have judged the credentials.
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
MAX_LOCKOUT_ATTEMPTS = 4


def _field(inputs: list[dict], predicate) -> str | None:
    return next((item["name"] for item in inputs if item.get("name") and predicate(item)), None)


def find_login_forms(pages: list[dict]) -> list[dict]:
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
    if response["status"] not in (200, 201, 302) or _hit_challenge(response):
        return False
    body = response.get("body", "").lower()
    if any(token in body for token in FAILURE_TOKENS):
        return False
    header_blob = " ".join(f"{k}:{v}" for k, v in response.get("headers", {}).items()).lower()
    return any(token in body for token in SUCCESS_TOKENS) or "set-cookie" in header_blob


def _is_locked(response: dict) -> bool:
    if response["status"] in LOCKOUT_STATUS:
        return True
    text = _visible_text(response)
    return any(token in text for token in LOCKOUT_TOKENS)


def _limiter_engaged(history: list[dict]) -> bool:
    """True on a lockout signal, or a turn to 403 partway through, which a rejection is not."""
    turned_forbidden = any(current["status"] == 403 and previous["status"] != 403
                           for previous, current in zip(history, history[1:]))
    return turned_forbidden or any(_is_locked(response) for response in history)


def _visible_text(response: dict) -> str:
    """Lowercased text a user would read, without markup, scripts or hidden field values."""
    body = response.get("body", "")
    if "<" in body:
        soup = BeautifulSoup(body, "html.parser")
        for element in soup(["script", "style", "noscript", "template"]):
            element.decompose()
        body = soup.get_text(" ")
    return " ".join(body.lower().split())


def _hit_challenge(response: dict) -> bool:
    text = _visible_text(response)
    return any(phrase in text for phrase in PRE_AUTH_CHALLENGE_PHRASES)


def _login_was_processed(response: dict) -> bool:
    """False unless the response shows the login handler really judged the credentials."""
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


def check_authentication(tools, pages: list[dict]) -> list[Finding]:
    findings: list[Finding] = []
    for form in find_login_forms(pages)[:MAX_LOGIN_FORMS]:
        action = form["action"]
        method = form.get("method", "POST")
        user_field = form["_user_field"]
        password_field = form["_password_field"]

        def attempt(username: str, password: str) -> dict:
            data = {item["name"]: item.get("value", "") for item in form.get("inputs", []) if item.get("name")}
            data[user_field] = username
            data[password_field] = password
            return tools.request(action, method, params=data if method == "GET" else None,
                                 data=data if method != "GET" else None)

        invalid = attempt("sentinel-unknown-user", "sentinel-wrong-password")
        history = [invalid]

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

    unique: dict[tuple, Finding] = {}
    for finding in findings:
        unique.setdefault((finding.category, finding.url, finding.parameter), finding)
    return list(unique.values())
