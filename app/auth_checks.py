"""Bounded, lab-only authentication-weakness checks (OWASP A07:2025).

The checks are deliberately conservative: a fixed, tiny set of default
credential pairs is tried against a detected login form, plus a bounded burst
of invalid logins to observe whether any rate limiting or lockout is applied.
No accounts are created or modified and the number of requests is capped.
"""
from app.schemas import Finding

# A minimal, well-known default-credential list. Kept short on purpose.
DEFAULT_CREDENTIALS = [("admin", "admin"), ("admin", "password"), ("administrator", "administrator")]

SUCCESS_TOKENS = ("\"status\":\"ok\"", "\"status\": \"ok\"", "authentication", "\"token\"", "set-cookie", "welcome", "success", "logout")
FAILURE_TOKENS = ("invalid", "incorrect", "error", "failed", "denied", "unauthorized")
LOCKOUT_STATUS = {429, 423}
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
    if response["status"] not in (200, 201, 302):
        return False
    body = response.get("body", "").lower()
    if any(token in body for token in FAILURE_TOKENS):
        return False
    header_blob = " ".join(f"{k}:{v}" for k, v in response.get("headers", {}).items()).lower()
    return any(token in body for token in SUCCESS_TOKENS) or "set-cookie" in header_blob


def _is_locked(response: dict) -> bool:
    if response["status"] in LOCKOUT_STATUS:
        return True
    return any(token in response.get("body", "").lower() for token in LOCKOUT_TOKENS)


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

        for username, password in DEFAULT_CREDENTIALS:
            trial = attempt(username, password)
            if _login_succeeded(trial) and not _login_succeeded(invalid):
                findings.append(Finding(
                    category="Authentication Failures", severity="high", url=action, parameter=password_field,
                    evidence=f"Default credentials {username}/{password} were accepted while an invalid credential was rejected. Only the tested pair is retained.",
                    recommendation="Remove default accounts and enforce a strong, unique password policy.",
                ))
                break

        statuses = [invalid["status"]]
        locked = _is_locked(invalid)
        for _ in range(MAX_LOCKOUT_ATTEMPTS):
            response = attempt("sentinel-lockout-user", "sentinel-wrong-password")
            statuses.append(response["status"])
            if _is_locked(response):
                locked = True
                break
        if not locked and all(status not in (0,) for status in statuses):
            findings.append(Finding(
                category="Authentication Failures", severity="medium", url=action, parameter=password_field,
                evidence=f"{len(statuses)} consecutive failed logins did not trigger any lockout or rate limiting (observed statuses {statuses}).",
                recommendation="Apply account lockout, exponential backoff or CAPTCHA after repeated authentication failures.",
            ))

    unique: dict[tuple, Finding] = {}
    for finding in findings:
        unique.setdefault((finding.category, finding.url, finding.parameter), finding)
    return list(unique.values())
