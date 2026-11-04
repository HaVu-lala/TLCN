import json as _json
import re
from collections import deque
from datetime import datetime
from urllib.parse import parse_qsl, urldefrag, urljoin, urlparse

import httpx
from bs4 import BeautifulSoup

from app.config import settings
from app.schemas import LoginRequest
from app.scope import ScopeError


class WebTools:
    def __init__(self, target_url: str, session_headers: dict[str, str] | None = None, login: LoginRequest | None = None):
        normalized_target = target_url.rstrip("/")
        parsed_target = urlparse(normalized_target)
        if parsed_target.path.lower() == "/webgoat":
            normalized_target = f"{parsed_target.scheme}://{parsed_target.netloc}/WebGoat/start.mvc"
        self.target_url = normalized_target
        self.authentication_status = "header-session" if session_headers else "anonymous"
        self.client = httpx.Client(
            timeout=settings.request_timeout_seconds,
            follow_redirects=True,
            headers=session_headers or {},
            event_hooks={"request": [self._guard_request]},
        )
        self.login_spec = login
        self.session_token: str | None = None
        self.request_log: list[dict] = []
        if login:
            self._login(login)

    def _guard_request(self, request: httpx.Request) -> None:
        target = urlparse(self.target_url)
        candidate = urlparse(str(request.url))
        if (candidate.scheme, candidate.hostname, candidate.port or (443 if candidate.scheme == "https" else 80)) != (target.scheme, target.hostname, target.port or (443 if target.scheme == "https" else 80)):
            raise ScopeError("Request or redirect is outside the target origin.")

    def _browser_context(self, playwright):
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(extra_http_headers=dict(self.client.headers))
        def guard_route(route):
            try:
                self._guard_request(httpx.Request(route.request.method, route.request.url))
            except ValueError:
                route.abort()
            else:
                route.continue_()
        context.route("**/*", guard_route)
        host = urlparse(self.target_url).hostname
        cookies = [
            {"name": name, "value": value, "domain": host, "path": "/"}
            for name, value in self.client.cookies.items()
        ]
        if cookies:
            context.add_cookies(cookies)
        return browser, context

    def _login(self, login: LoginRequest) -> None:
        self._guard_request(httpx.Request("POST", str(login.login_url)))
        try:
            login_url = str(login.login_url)
            if "/WebGoat/login" in urlparse(login_url).path:
                self.client.get(login_url).raise_for_status()
                response = self.client.post(
                    login_url,
                    data={"username": login.username, "password": login.password},
                )
                response.raise_for_status()
                if "?error" in str(response.url) or urlparse(str(response.url)).path.endswith("/login"):
                    raise ValueError("WebGoat login failed; verify username and password.")
                self.authentication_status = "authenticated"
                return
            cookies_before = set(self.client.cookies.keys())
            # Modern JSON APIs (e.g. Juice Shop) expect {"email", "password"}.
            token = self._attempt_login(login_url, json={"email": login.username, "password": login.password})
            new_cookies = set(self.client.cookies.keys()) - cookies_before
            if not token and not new_cookies:
                # Traditional servlet/form apps expect form fields {"username", "password"}.
                token = self._attempt_login(login_url, data={"username": login.username, "password": login.password})
                new_cookies = set(self.client.cookies.keys()) - cookies_before
        except (httpx.HTTPError, ValueError) as exc:
            raise ValueError("Lab login failed; verify the authorized lab credentials and login URL.") from exc
        # Success is a recognized token in the body, or a freshly set session cookie.
        if not token and not new_cookies:
            raise ValueError("Lab login failed; verify the authorized lab credentials and login URL.")
        if token:
            self.client.headers["Authorization"] = f"Bearer {token}"
            self.session_token = token
        self.authentication_status = "authenticated"

    def _attempt_login(self, login_url: str, *, json: dict | None = None, data: dict | None = None) -> str | None:
        """Post credentials and return a session token if the server returns one.

        Returns None on any non-success response so the caller can try another
        credential encoding. A set session cookie is detected separately by the caller.
        """
        try:
            response = self.client.post(login_url, json=json, data=data)
        except httpx.HTTPError:
            return None
        if response.status_code >= 400:
            return None
        try:
            payload = response.json()
        except ValueError:
            return None
        if not isinstance(payload, dict):
            return None
        auth = payload.get("authentication")
        if isinstance(auth, dict) and auth.get("token"):
            return auth["token"]
        token = payload.get("token")
        return token if isinstance(token, str) else None

    def crawl(self) -> list[dict]:
        queue = deque([self.target_url])
        seen: set[str] = set()
        pages: list[dict] = []
        base_host = urlparse(self.target_url).netloc
        while queue and len(pages) < settings.max_crawl_pages:
            url = urldefrag(queue.popleft())[0]
            if url in seen or urlparse(url).netloc != base_host:
                continue
            seen.add(url)
            try:
                response = self.client.get(url)
            except ScopeError as exc:
                pages.append({"url": url, "status": 0, "error": str(exc), "scope_blocked": True, "forms": []})
                continue
            except httpx.HTTPError as exc:
                pages.append({"url": url, "status": 0, "error": str(exc), "forms": []})
                continue
            content_type = response.headers.get("content-type", "")
            if "/webgoat" in urlparse(self.target_url).path.lower() and urlparse(str(response.url)).path.endswith("/login"):
                raise ValueError("WebGoat requires a valid lab login or authenticated session cookie.")
            forms = []
            if "html" in content_type:
                soup = BeautifulSoup(response.text, "html.parser")
                for form in soup.find_all("form"):
                    inputs = [
                        {"name": field.get("name"), "type": field.get("type", "text"), "value": field.get("value", "")}
                        for field in form.find_all(["input", "textarea"])
                        if field.get("name")
                    ]
                    forms.append({"action": urljoin(url, form.get("action") or url), "method": (form.get("method") or "get").upper(), "inputs": inputs})
                # SPA forms submit via fetch(); when a form has no real action, try to
                # resolve its submit endpoint from same-origin API paths in inline scripts.
                script_text = " ".join(script.get_text() for script in soup.find_all("script"))
                api_paths = re.findall(r"""['"](/(?:api|auth)/[A-Za-z0-9_][A-Za-z0-9_./-]*)['"]""", script_text)
                if api_paths:
                    for form in forms:
                        if form.get("source") or form["action"].rstrip("/") != url.rstrip("/"):
                            continue
                        has_password = any(f.get("type") == "password" for f in form["inputs"])
                        if not has_password:
                            continue
                        target = next((p for p in api_paths if any(k in p.lower() for k in ("login", "auth", "signin"))), api_paths[0])
                        form["action"] = urljoin(url, target)
                        form["method"] = "POST"
                        form["source"] = "js-resolved-endpoint"
                for link in soup.find_all("a", href=True):
                    next_url = urljoin(url, link["href"])
                    link_path = urlparse(next_url).path.lower()
                    if any(part in link_path for part in ("logout", "signout", "register", "registration", "/login")):
                        continue
                    if urlparse(next_url).netloc == base_host:
                        queue.append(next_url)
                if "OWASP Juice Shop" in response.text and not forms:
                    forms.append(
                        {
                            "action": urljoin(url, "/rest/products/search"),
                            "method": "GET",
                            "inputs": [{"name": "q", "type": "search"}],
                            "source": "juice-shop-api-adapter",
                        }
                    )
            pages.append({"url": url, "status": response.status_code, "content_type": content_type,
                           "headers": dict(response.headers), "body": response.text[:8000],
                           "forms": forms, "endpoints": []})
            # Treat reflected GET query parameters as injectable endpoints so the
            # attack stage can test them for reflected XSS / error-based SQLi.
            query_params = [name for name, _ in parse_qsl(urlparse(url).query, keep_blank_values=True)]
            if query_params:
                pages[-1]["endpoints"].append({"url": url.split("?", 1)[0], "method": "GET",
                                               "parameters": sorted(set(query_params)), "source": "query-param"})
            if '<title>Sentinel Demo Lab</title>' in response.text and urlparse(url).path == "/demo":
                pages[-1]["fixture_id"] = "sentinel-demo-v2"
            elif '<title>Sentinel Safe Demo Lab</title>' in response.text and urlparse(url).path == "/demo-safe":
                pages[-1]["fixture_id"] = "sentinel-safe-v2"
            if pages[-1].get("fixture_id"):
                # Advertise the object endpoint so an agent can test object-level authorization (BOLA/IDOR).
                pages[-1]["endpoints"].append({"url": url.rstrip("/") + "/object", "method": "GET",
                                               "parameters": ["id"], "source": "sentinel-demo-adapter"})
            if "OWASP Juice Shop" in response.text:
                pages[-1]["lab"] = "juice-shop"
                # Known oracle-backed Juice Shop surfaces, loaded through the SPA and absent from the shell.
                # Only bounded routes with a verification oracle are advertised so the planner can select them.
                pages[-1]["endpoints"].extend([
                    {"url": urljoin(url, "/rest/products/1/reviews"), "method": "PUT", "parameters": ["message"], "source": "juice-shop-lab-adapter"},
                    {"url": urljoin(url, "/rest/basket/1"), "method": "GET", "parameters": ["basketId"], "source": "juice-shop-lab-adapter"},
                ])
            elif "/webgoat" in urlparse(self.target_url).path.lower():
                pages[-1]["lab"] = "webgoat"
                # Lesson endpoints are loaded dynamically and are absent from the landing HTML.
                # Only bounded, oracle-backed lesson routes are advertised so the planner can select them.
                pages[-1]["endpoints"].extend([
                    {"url": urljoin(url, "/WebGoat/SqlInjection/attack8"), "method": "POST", "parameters": [], "source": "webgoat-lab-adapter"},
                    {"url": urljoin(url, "/WebGoat/CrossSiteScriptingStored/stored-xss"), "method": "POST", "parameters": ["text"], "source": "webgoat-lab-adapter"},
                    {"url": urljoin(url, "/WebGoat/IDOR/profile/2342388"), "method": "GET", "parameters": ["userId"], "source": "webgoat-lab-adapter"},
                ])
            elif "bookishbliss" in response.text.lower():
                # Ứng dụng bookstore tự xây: quảng bá các điểm cuối có bề mặt kiểm thử
                # (tìm kiếm phản chiếu, tải tệp, nhập XML) để detector tổng quát tiếp cận.
                # Không đặt cờ "lab" để vẫn chạy detector tổng quát + oracle trình duyệt.
                pages[-1]["endpoints"].extend([
                    {"url": urljoin(url, "/search"), "method": "GET", "parameters": ["q"], "source": "bookstore-adapter"},
                    {"url": urljoin(url, "/ebook"), "method": "GET", "parameters": ["file"], "source": "bookstore-adapter"},
                    {"url": urljoin(url, "/import"), "method": "POST", "parameters": [], "accepts_xml": True, "source": "bookstore-adapter"},
                ])
        if settings.browser_scan_enabled and not any(page.get("lab") for page in pages):
            self._augment_with_browser(pages)
        self._inject_login_surface(pages)
        return pages

    def _inject_login_surface(self, pages: list[dict]) -> None:
        """Advertise a user-supplied login endpoint as an attackable form.

        A login page is often a JavaScript modal the crawler never reaches, so a
        provided login_url would otherwise go untested. Exposing it as a form with
        username/password fields lets the attack stage probe it for SQL injection
        and lets the A07 check observe default-credential / lockout behaviour. The
        oracle still decides every finding, so no false positive is introduced.
        """
        if not self.login_spec:
            return
        login_url = str(self.login_spec.login_url)
        already = any(form.get("action", "").rstrip("/") == login_url.rstrip("/")
                      for page in pages for form in page.get("forms", []))
        if already:
            return
        pages.append({
            "url": login_url, "status": 0, "content_type": "", "headers": {}, "body": "",
            "forms": [{
                "action": login_url, "method": "POST",
                "inputs": [{"name": "username", "type": "text", "value": ""},
                           {"name": "password", "type": "password", "value": ""}],
                "source": "provided-login",
            }],
            "endpoints": [],
        })

    def _augment_with_browser(self, pages: list[dict]) -> None:
        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            return
        if not pages:
            return
        try:
            with sync_playwright() as playwright:
                browser, context = self._browser_context(playwright)
                # If we hold a session token, seed it into localStorage under common keys so
                # single-page apps that keep auth there (not in a cookie) render as logged in,
                # exposing authenticated menus and the deep pages linked from them.
                if self.session_token:
                    context.add_init_script(
                        "try { var t = " + _json.dumps(self.session_token) + "; "
                        "['auth_token','token','jwt','access_token','authToken','accessToken']"
                        ".forEach(function(k){ localStorage.setItem(k, t); }); } catch (e) {}"
                    )
                page = context.new_page()
                network_requests: list[dict] = []

                def capture_request(request) -> None:
                    parsed = urlparse(request.url)
                    excluded = (".js", ".css", ".png", ".jpg", ".jpeg", ".gif", ".ico", ".woff", ".woff2")
                    ignored_prefixes = ("/assets/", "/socket.io/", "/static/")
                    if parsed.netloc == urlparse(self.target_url).netloc and not parsed.path.endswith(excluded) and not parsed.path.startswith(ignored_prefixes):
                        entry = {
                            "url": request.url,
                            "method": request.method,
                            "parameters": [name for name, _ in parse_qsl(parsed.query, keep_blank_values=True)],
                            "source": "browser-network",
                        }
                        # Record JSON body field names so the attack stage can inject into
                        # a JSON body parameter (e.g. a password-change API), not only query/form.
                        if request.method in ("POST", "PUT", "PATCH"):
                            try:
                                body = _json.loads(request.post_data or "")
                                if isinstance(body, dict):
                                    entry["json_fields"] = [k for k in body.keys() if isinstance(k, str)]
                            except (ValueError, TypeError):
                                pass
                        network_requests.append(entry)

                page.on("request", capture_request)
                page.goto(pages[0]["url"], wait_until="domcontentloaded", timeout=settings.browser_timeout_ms)
                page.wait_for_timeout(750)
                dismiss = page.get_by_role("button", name="Close Welcome Banner")
                if dismiss.count():
                    dismiss.first.click()
                enabled_inputs = page.locator("input:not([disabled]), textarea:not([disabled])")
                if not enabled_inputs.count():
                    search_icon = page.get_by_text("search", exact=True)
                    if search_icon.count():
                        search_icon.first.click()
                        page.wait_for_timeout(250)
                inputs = page.locator("input, textarea").evaluate_all(
                    """elements => elements.filter(element => !element.hidden && !element.disabled && !['checkbox', 'radio', 'hidden', 'submit', 'button', 'file', 'range', 'color'].includes(element.type)).map((element, index) => ({
                        name: element.name || `browser_input_${index}`,
                        type: element.type || 'text',
                        selector: element.id ? `#${element.id}` : (element.name ? `${element.tagName.toLowerCase()}[name=\\\"${element.name}\\\"]` : `${element.tagName.toLowerCase()}:nth-of-type(${index + 1})`)
                    }))"""
                )
                browser_adapter_only = all(form.get("source") == "juice-shop-api-adapter" for form in pages[0]["forms"])
                if inputs and (not pages[0]["forms"] or browser_adapter_only):
                    pages[0]["forms"].extend(
                        {"action": page.url, "method": "GET", "inputs": [item], "source": "browser"}
                        for item in inputs
                    )
                # Breadth-first harvest of same-origin links from the fully rendered DOM,
                # following them several levels deep so pages reachable only after JavaScript
                # runs - and only after login (menus, orders, detail pages) - enter the crawl
                # surface too. Deeper coverage is favoured over speed here. We only navigate
                # and read links/endpoints; no input is touched, so no fragile DOM interaction.
                link_filter_js = (
                    """elements => elements.map(element => element.href).filter(href => {
                        try {
                            const url = new URL(href, window.location.href);
                            if (url.origin !== window.location.origin) return false;
                            if (/\\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|pdf|zip|mp4|webp)(\\?|$)/i.test(url.pathname)) return false;
                            return true;
                        } catch (e) { return false; }
                    })"""
                )
                known_urls = {entry["url"] for entry in pages}
                # Visit at most one URL per distinct path+fragment; testing one instance of
                # a parameterised page (e.g. one detail?id=) is enough and keeps it bounded.
                seen_keys = set()
                for entry in pages:
                    pe = urlparse(entry.get("url", ""))
                    seen_keys.add((pe.path, pe.fragment))
                queue = deque(page.locator("a[href]").evaluate_all(link_filter_js))
                visits = 0
                visit_budget = settings.max_crawl_pages * 4
                while queue and len(pages) < settings.max_crawl_pages and visits < visit_budget:
                    route = queue.popleft()
                    visits += 1
                    parsed_route = urlparse(route)
                    if any(part in parsed_route.path.lower() for part in ("logout", "signout", "register", "registration", "/login")):
                        continue
                    route_key = (parsed_route.path, parsed_route.fragment)
                    if route in known_urls or route_key in seen_keys:
                        continue
                    known_urls.add(route)
                    seen_keys.add(route_key)
                    try:
                        page.goto(route, wait_until="domcontentloaded", timeout=settings.browser_timeout_ms)
                        page.wait_for_timeout(400)
                        dismiss = page.get_by_role("button", name="Close Welcome Banner")
                        if dismiss.count():
                            dismiss.first.click()
                        child_links = page.locator("a[href]").evaluate_all(link_filter_js)
                    except Exception:
                        child_links = []
                    for child in child_links:
                        child_parsed = urlparse(child)
                        child_key = (child_parsed.path, child_parsed.fragment)
                        if child not in known_urls and child_key not in seen_keys:
                            queue.append(child)
                    route_endpoints = []
                    route_params = [name for name, _ in parse_qsl(parsed_route.query, keep_blank_values=True)]
                    if route_params:
                        route_endpoints.append({"url": route.split("?", 1)[0], "method": "GET",
                                                "parameters": sorted(set(route_params)), "source": "browser-link"})
                    # Fetch server-rendered HTML routes over HTTP to mine forms/scripts for
                    # API endpoints (e.g. a change-password JSON API) that no request revealed.
                    last_seg = parsed_route.path.rsplit("/", 1)[-1]
                    looks_html = parsed_route.path.lower().endswith((".jsp", ".html", ".htm", ".php")) or "." not in last_seg
                    if looks_html:
                        try:
                            resp = self.client.get(route)
                            if "html" in resp.headers.get("content-type", ""):
                                route_endpoints.extend(self._credential_json_endpoints(route, resp.text))
                        except (httpx.HTTPError, ScopeError):
                            pass
                    pages.append(
                        {
                            "url": route,
                            "status": 200,
                            "content_type": "text/html",
                            "browser_rendered": True,
                            "forms": [],
                            "endpoints": route_endpoints,
                        }
                    )
                pages[0]["browser_rendered"] = True
                pages[0]["endpoints"] = self._merge_endpoints(pages[0].get("endpoints", []), network_requests)
                context.close()
                browser.close()
        except Exception as exc:
            pages[0]["browser_error"] = str(exc)

    def _credential_json_endpoints(self, url: str, html: str) -> list[dict]:
        """Discover a credential-change JSON API without submitting the form.

        Many apps render a change-password form in the page HTML while the actual
        request is a JSON fetch to an /api/...password endpoint declared in the page
        scripts. When a form with a password field coexists with such a path, register
        that path as a JSON endpoint whose fields are the form's input names, so the
        attack stage can probe it. The oracle still decides any finding.
        """
        endpoints: list[dict] = []
        try:
            soup = BeautifulSoup(html, "html.parser")
        except Exception:  # noqa: BLE001
            return endpoints
        script_text = " ".join(script.get_text() for script in soup.find_all("script"))
        # Match an /api or /auth path anywhere, including inside template literals
        # such as `${contextPath}/api/profile/password`, not only quoted string literals.
        api_paths = re.findall(r"(/(?:api|auth)/[A-Za-z0-9_][A-Za-z0-9_./-]*)", script_text)
        pwd_api = next((p for p in api_paths if "password" in p.lower()), None)
        if not pwd_api:
            return endpoints
        for form in soup.find_all("form"):
            has_password = any(field.get("type") == "password" for field in form.find_all("input"))
            fields = [field.get("name") for field in form.find_all(["input", "textarea"]) if field.get("name")]
            if has_password and fields:
                endpoints.append({"url": urljoin(url, pwd_api), "method": "POST", "parameters": [],
                                  "json_fields": fields, "source": "js-resolved-json"})
                break
        return endpoints

    @staticmethod
    def _merge_endpoints(existing: list[dict], discovered: list[dict]) -> list[dict]:
        merged = {(item["method"], item["url"]): item for item in existing}
        for item in discovered:
            key = (item["method"], item["url"])
            if key in merged:
                merged[key]["parameters"] = sorted(set(merged[key].get("parameters", [])) | set(item.get("parameters", [])))
                if item.get("json_fields"):
                    merged[key]["json_fields"] = sorted(set(merged[key].get("json_fields", [])) | set(item["json_fields"]))
            else:
                merged[key] = item
        return list(merged.values())

    def browser_request(self, form: dict, field: str, payload: str) -> dict:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as playwright:
            browser, context = self._browser_context(playwright)
            page = context.new_page()
            page.goto(form["action"], wait_until="domcontentloaded", timeout=settings.browser_timeout_ms)
            page.wait_for_timeout(500)
            dismiss = page.get_by_role("button", name="Close Welcome Banner")
            if dismiss.count():
                dismiss.first.click()
            selector = next(item["selector"] for item in form["inputs"] if item["name"] == field)
            input_locator = page.locator(selector).first
            if not input_locator.is_enabled():
                search_icon = page.get_by_text("search", exact=True)
                if search_icon.count():
                    search_icon.first.click()
                    page.wait_for_timeout(250)
            if not input_locator.is_visible() or not input_locator.is_enabled():
                return {"url": page.url, "status": 0, "headers": {}, "body": ""}
            input_locator.fill(payload)
            input_locator.press("Enter")
            page.wait_for_timeout(500)
            result = {"url": page.url, "status": 200, "headers": {}, "body": page.content()[:12000]}
            context.close()
            browser.close()
            return result

    def request(self, url: str, method: str = "GET", params: dict | None = None, data=None, headers: dict | None = None, json_body=None, follow_redirects: bool | None = None) -> dict:
        self._guard_request(httpx.Request(method, url))
        # Record the actual outgoing arguments (including any payload) so the report can
        # prove exactly what was sent, not merely state a conclusion.
        parts = []
        for src in (params, data, json_body):
            if isinstance(src, dict):
                parts += [f"{k}={str(v)[:60]}" for k, v in src.items()]
        args = " ; ".join(parts)[:300]
        try:
            # follow_redirects=False cho phép oracle Open Redirect đọc header Location (3xx).
            kwargs = {} if follow_redirects is None else {"follow_redirects": follow_redirects}
            response = self.client.request(method, url, params=params, data=data, headers=headers, json=json_body, **kwargs)
        except httpx.HTTPError as exc:
            self._log_request(method, url, args, 0)
            return {"url": url, "status": 0, "headers": {}, "body": "", "error": str(exc)}
        self._log_request(method, str(response.url), args, response.status_code)
        # Keep structured API responses parseable when a probe returns many products.
        limit = 1_000_000 if "json" in response.headers.get("content-type", "") else 12000
        return {"url": str(response.url), "status": response.status_code, "headers": dict(response.headers), "body": response.text[:limit]}

    def _log_request(self, method: str, url: str, args: str, status: int) -> None:
        if not hasattr(self, "request_log"):
            self.request_log = []
        if len(self.request_log) < 500:
            ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]
            self.request_log.append({"seq": len(self.request_log) + 1, "ts": ts,
                                     "method": method, "url": url, "args": args, "status": status})
