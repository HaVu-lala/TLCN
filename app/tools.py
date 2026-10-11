from collections import deque
from urllib.parse import urldefrag, urljoin, urlparse

import httpx
from bs4 import BeautifulSoup

from app.config import settings
from app.schemas import LoginRequest


class WebTools:
    def __init__(self, target_url: str, session_headers: dict[str, str] | None = None, login: LoginRequest | None = None):
        self.target_url = target_url.rstrip("/")
        self.authentication_status = "header-session" if session_headers else "anonymous"
        self.client = httpx.Client(
            timeout=settings.request_timeout_seconds,
            follow_redirects=True,
            headers=session_headers or {},
        )
        if login:
            self._login(login)

    def _login(self, login: LoginRequest) -> None:
        if urlparse(str(login.login_url)).netloc != urlparse(self.target_url).netloc:
            raise ValueError("Login URL must use the same host as the scan target.")
        try:
            login_url = str(login.login_url)
            if "/WebGoat/login" in urlparse(login_url).path:
                response = self.client.post(
                    login_url,
                    data={"username": login.username, "password": login.password},
                )
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
        if not token and "authentication" not in payload:
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
            except httpx.HTTPError as exc:
                pages.append({"url": url, "status": 0, "error": str(exc), "forms": []})
                continue
            content_type = response.headers.get("content-type", "")
            forms = []
            if "html" in content_type:
                soup = BeautifulSoup(response.text, "html.parser")
                for form in soup.find_all("form"):
                    inputs = [
                        {"name": field.get("name"), "type": field.get("type", "text")}
                        for field in form.find_all(["input", "textarea"])
                        if field.get("name")
                    ]
                    forms.append({"action": urljoin(url, form.get("action") or url), "method": (form.get("method") or "get").upper(), "inputs": inputs})
                for link in soup.find_all("a", href=True):
                    next_url = urljoin(url, link["href"])
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
            pages.append({"url": url, "status": response.status_code, "content_type": content_type, "forms": forms})
        if settings.browser_scan_enabled:
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
                browser = playwright.chromium.launch(headless=True)
                context = browser.new_context(extra_http_headers=self.client.headers)
                page = context.new_page()
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
                        return url.origin === window.location.origin && url.pathname.startsWith('/WebGoat');
                    })"""
                )
                known_urls = {entry["url"] for entry in pages}
                for route in browser_routes:
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
                context.close()
                browser.close()
        except Exception as exc:
            pages[0]["browser_error"] = str(exc)

    def browser_request(self, form: dict, field: str, payload: str) -> dict:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            context = browser.new_context(extra_http_headers=self.client.headers)
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

    def request(self, url: str, method: str = "GET", params: dict | None = None, data: dict | None = None) -> dict:
        response = self.client.request(method, url, params=params, data=data)
        return {"url": str(response.url), "status": response.status_code, "headers": dict(response.headers), "body": response.text[:12000]}
