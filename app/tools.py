from collections import deque
from urllib.parse import urldefrag, urljoin, urlparse

import httpx
from bs4 import BeautifulSoup

from app.config import settings


class WebTools:
    def __init__(self, target_url: str, session_headers: dict[str, str] | None = None):
        self.target_url = target_url.rstrip("/")
        self.client = httpx.Client(
            timeout=settings.request_timeout_seconds,
            follow_redirects=True,
            headers=session_headers or {},
        )

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
            pages.append({"url": url, "status": response.status_code, "content_type": content_type, "forms": forms})
        return pages

    def request(self, url: str, method: str = "GET", params: dict | None = None, data: dict | None = None) -> dict:
        response = self.client.request(method, url, params=params, data=data)
        return {"url": str(response.url), "status": response.status_code, "headers": dict(response.headers), "body": response.text[:12000]}
