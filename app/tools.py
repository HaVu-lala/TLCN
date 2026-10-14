from collections import deque
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
            response = self.client.post(
                login_url,
                json={"email": login.username, "password": login.password},
            )
            response.raise_for_status()
            payload = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise ValueError("Lab login failed; verify the authorized lab credentials and login URL.") from exc
        token = payload.get("authentication", {}).get("token") or payload.get("token")
        if not token:
            raise ValueError("Lab login succeeded without a recognized session token.")
        if token:
            self.client.headers["Authorization"] = f"Bearer {token}"
        self.authentication_status = "authenticated"

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
            pages.append({"url": url, "status": response.status_code, "content_type": content_type, "forms": forms, "endpoints": []})
            if '<title>Sentinel Demo Lab</title>' in response.text and urlparse(url).path == "/demo":
                pages[-1]["fixture_id"] = "sentinel-demo-v2"
            elif '<title>Sentinel Safe Demo Lab</title>' in response.text and urlparse(url).path == "/demo-safe":
                pages[-1]["fixture_id"] = "sentinel-safe-v2"
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
        if settings.browser_scan_enabled and not any(page.get("lab") for page in pages):
            self._augment_with_browser(pages)
        return pages

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
                page = context.new_page()
                network_requests: list[dict] = []

                def capture_request(request) -> None:
                    parsed = urlparse(request.url)
                    excluded = (".js", ".css", ".png", ".jpg", ".jpeg", ".gif", ".ico", ".woff", ".woff2")
                    ignored_prefixes = ("/assets/", "/socket.io/", "/static/")
                    if parsed.netloc == urlparse(self.target_url).netloc and not parsed.path.endswith(excluded) and not parsed.path.startswith(ignored_prefixes):
                        network_requests.append({
                            "url": request.url,
                            "method": request.method,
                            "parameters": [name for name, _ in parse_qsl(parsed.query, keep_blank_values=True)],
                            "source": "browser-network",
                        })

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
                browser_routes = page.locator("a[href]").evaluate_all(
                    """elements => elements.map(element => element.href).filter(href => {
                        const url = new URL(href, window.location.href);
                        return url.origin === window.location.origin && (url.pathname.startsWith('/WebGoat') || url.hash.startsWith('#/'));
                    })"""
                )
                known_urls = {entry["url"] for entry in pages}
                for route in browser_routes:
                    if any(part in urlparse(route).path.lower() for part in ("logout", "signout", "register", "registration", "/login")):
                        continue
                    if len(pages) >= settings.max_crawl_pages or route in known_urls:
                        continue
                    page.goto(route, wait_until="domcontentloaded", timeout=settings.browser_timeout_ms)
                    page.wait_for_timeout(400)
                    dismiss = page.get_by_role("button", name="Close Welcome Banner")
                    if dismiss.count():
                        dismiss.first.click()
                    route_inputs = page.locator("input, textarea").evaluate_all(
                        """elements => elements.filter(element => !element.hidden && !element.disabled && !['checkbox', 'radio', 'hidden', 'submit', 'button', 'file', 'range', 'color'].includes(element.type)).map((element, index) => ({
                            name: element.name || `browser_input_${index}`,
                            type: element.type || 'text',
                            selector: element.id ? `#${element.id}` : (element.name ? `${element.tagName.toLowerCase()}[name=\\\"${element.name}\\\"]` : `${element.tagName.toLowerCase()}:nth-of-type(${index + 1})`)
                        }))"""
                    )
                    pages.append(
                        {
                            "url": route,
                            "status": 200,
                            "content_type": "text/html",
                            "browser_rendered": True,
                            "forms": [
                                {"action": route, "method": "GET", "inputs": [item], "source": "browser"}
                                for item in route_inputs
                            ],
                        }
                    )
                    known_urls.add(route)
                pages[0]["browser_rendered"] = True
                pages[0]["endpoints"] = self._merge_endpoints(pages[0].get("endpoints", []), network_requests)
                context.close()
                browser.close()
        except Exception as exc:
            pages[0]["browser_error"] = str(exc)

    @staticmethod
    def _merge_endpoints(existing: list[dict], discovered: list[dict]) -> list[dict]:
        merged = {(item["method"], item["url"]): item for item in existing}
        for item in discovered:
            key = (item["method"], item["url"])
            if key in merged:
                merged[key]["parameters"] = sorted(set(merged[key].get("parameters", [])) | set(item.get("parameters", [])))
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

    def request(self, url: str, method: str = "GET", params: dict | None = None, data=None, headers: dict | None = None) -> dict:
        self._guard_request(httpx.Request(method, url))
        try:
            response = self.client.request(method, url, params=params, data=data, headers=headers)
        except httpx.HTTPError as exc:
            return {"url": url, "status": 0, "headers": {}, "body": "", "error": str(exc)}
        # Keep structured API responses parseable when a probe returns many products.
        limit = 1_000_000 if "json" in response.headers.get("content-type", "") else 12000
        return {"url": str(response.url), "status": response.status_code, "headers": dict(response.headers), "body": response.text[:limit]}
