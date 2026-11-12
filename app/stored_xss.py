"""Oracle Stored XSS hộp đen, tổng quát (chế độ chủ động - opt-in).

Nguyên lý "gieo dấu rồi đi xem lại", KHÔNG ghim trước endpoint hay trang nào:

  1. GIEO: lái Chromium mở từng trang đã crawl, điền vào mọi ô nhập một payload
     mang MARKER duy nhất, rồi kích hoạt submit để CHÍNH JavaScript của ứng dụng
     gửi request lưu trữ (đúng endpoint, đúng shape) - bắt được cả form SPA ẩn
     trong JS, không chỉ form HTML tĩnh.
  2. ĐI XEM LẠI: mở lại toàn bộ trang bằng Chromium và nghe sự kiện `dialog`.
     Marker nào TỰ bật alert nghĩa là nội dung đã bị lưu và render KHÔNG lọc
     => Stored XSS thật (oracle thực thi trình duyệt, không phải đoán).

Marker duy nhất theo từng ô => truy ngược được chính xác ô nào gây lỗi. Vì chỉ
mở lại các URL "sạch" (không mang payload trên query), một marker chỉ nổ khi nội
dung được LƯU rồi hiện lại - nên không nhầm với reflected XSS.

Bước GIEO có GHI dữ liệu (state-changing) nên oracle chỉ chạy khi
settings.aggressive_scan = True (tương tự "Active scan" của Burp/ZAP) và trong
phạm vi được Scope Guard cho phép. Marker mang tiền tố 'sentinel-' để người dọn
tìm ra; bản ghi test có thể còn sót (hộp đen không chắc biết đường xóa) và điều
này được nêu rõ trong evidence.
"""
import uuid
from urllib.parse import urlparse

from app._playwright_compat import playwright_event_loop_policy
from app.config import settings
from app.schemas import Finding

# Từ khóa nút gửi (đa ngôn ngữ) để kích hoạt submit của form SPA.
SUBMIT_WORDS = (
    "gửi", "đăng", "bình luận", "đánh giá", "nhận xét", "lưu", "comment",
    "review", "submit", "post", "send", "save",
)
MAX_PAGES = 24      # chặn số trang gieo/kiểm để tránh quét vô hạn
MAX_FIELDS = 12     # chặn số ô mỗi trang
# input KHÔNG phải ô nhập văn bản -> bỏ qua.
SKIP_INPUT_TYPES = {
    "hidden", "password", "file", "checkbox", "radio", "submit",
    "button", "image", "reset", "range", "color",
}


# [TN2 - XSS] Stored XSS hộp đen tổng quát: seed payload rồi đọc lại ở request độc lập (chỉ chạy khi aggressive_scan).
def stored_xss_blackbox(tools, pages: list[dict]) -> list[Finding]:
    if not settings.aggressive_scan or not settings.browser_scan_enabled:
        return []
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return []

    target = urlparse(tools.target_url)
    urls: list[str] = []
    seen: set[str] = set()
    for page_info in pages:
        url = page_info.get("url")
        if not url or urlparse(url).netloc != target.netloc or url in seen:
            continue
        seen.add(url)
        urls.append(url)
    urls = urls[:MAX_PAGES]
    if not urls:
        return []

    seeded: dict[str, dict] = {}      # marker -> {"url":.., "field":..}
    verify_urls: set[str] = set(urls)  # trang sẽ mở lại để bắt marker nổ
    findings: list[Finding] = []
    try:
        with playwright_event_loop_policy(), sync_playwright() as pw:
            browser, context = tools._browser_context(pw)
            try:
                page = context.new_page()
                # --- Pha GIEO ---
                for url in urls:
                    try:
                        page.goto(url, wait_until="networkidle", timeout=settings.browser_timeout_ms)
                    except Exception:
                        continue
                    if _seed_page(page, url, seeded):
                        # nơi app điều hướng tới sau submit cũng có thể render nội dung lưu
                        try:
                            verify_urls.add(page.url)
                        except Exception:
                            pass
                if not seeded:
                    return []
                # --- Pha ĐI XEM LẠI ---
                verifier = context.new_page()
                executed: list[str] = []
                verifier.on("dialog", lambda d: (executed.append(d.message), d.dismiss()))
                for url in list(verify_urls)[:MAX_PAGES]:
                    try:
                        verifier.goto(url, wait_until="networkidle", timeout=settings.browser_timeout_ms)
                        verifier.wait_for_timeout(500)
                    except Exception:
                        continue
                for marker in set(executed):
                    info = seeded.get(marker)
                    if not info:
                        continue
                    findings.append(Finding(
                        category="Stored XSS",
                        severity="high",
                        url=info["url"],
                        parameter=info.get("field"),
                        evidence=(
                            "Chế độ chủ động (hộp đen): payload mang marker duy nhất được gửi qua ô nhập "
                            f"'{info.get('field')}' trên {info['url']}, sau đó TỰ THỰC THI trong Chromium khi "
                            "mở lại trang (oracle gieo-dấu-rồi-xem-lại). Nội dung người dùng được lưu và render "
                            f"không mã hóa. Bản ghi test còn marker '{marker}' trên hệ thống - cần dọn thủ công."
                        ),
                        recommendation=(
                            "Mã hóa đầu ra theo đúng ngữ cảnh khi hiển thị nội dung do người dùng lưu (HTML/JS); "
                            "áp dụng Content-Security-Policy chặt chẽ."
                        ),
                    ))
            finally:
                context.close()
                browser.close()
    except Exception:
        return findings
    return findings


def _seed_page(page, url: str, seeded: dict[str, dict]) -> bool:
    """Điền marker vào mọi ô nhập trên trang rồi kích hoạt submit. Trả True nếu có gieo."""
    try:
        handles = page.query_selector_all(
            "input, textarea, [contenteditable='true'], [contenteditable='']"
        )
    except Exception:
        return False
    count = 0
    for handle in handles:
        if count >= MAX_FIELDS:
            break
        try:
            tag = (handle.evaluate("e => e.tagName") or "").lower()
            input_type = (handle.get_attribute("type") or "text").lower()
        except Exception:
            continue
        if tag == "input" and input_type in SKIP_INPUT_TYPES:
            continue
        marker = "sentinel-" + uuid.uuid4().hex
        payload = f"<img src=x onerror=alert('{marker}')>"
        try:
            field = handle.get_attribute("name") or handle.get_attribute("id")
        except Exception:
            field = None
        try:
            if tag in ("input", "textarea"):
                handle.fill(payload)
            else:
                handle.evaluate(
                    "(e, v) => { e.innerText = v; e.dispatchEvent(new Event('input', {bubbles:true})); }",
                    payload,
                )
        except Exception:
            continue
        seeded[marker] = {"url": url, "field": field or f"{tag}#{count}"}
        count += 1
    if count == 0:
        return False

    # Best-effort: nhiều form đánh giá bắt buộc chọn sao -> click một mức sao.
    for selector in ("[data-rating]", "[class*=star]", "[aria-label*='star' i]", "[aria-label*='sao' i]"):
        try:
            stars = page.query_selector_all(selector)
            if stars:
                stars[-1].click(timeout=1000)
                break
        except Exception:
            continue

    # Submit: ưu tiên form thật (tôn trọng handler JS), rồi click nút theo từ khóa.
    try:
        page.evaluate(
            "() => { document.querySelectorAll('form').forEach(f => { try { if (f.requestSubmit) f.requestSubmit(); } catch (e) {} }); }"
        )
        page.wait_for_timeout(400)
    except Exception:
        pass
    try:
        buttons = page.query_selector_all("button, input[type=submit], [role=button]")
    except Exception:
        buttons = []
    for button in buttons:
        try:
            text = (button.inner_text() or "").strip().lower()
        except Exception:
            text = ""
        if text and any(word in text for word in SUBMIT_WORDS):
            try:
                button.click(timeout=1500)
                page.wait_for_timeout(600)
            except Exception:
                continue
    return True
