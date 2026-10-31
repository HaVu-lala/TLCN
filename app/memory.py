"""Bộ nhớ dài hạn (Long-term Memory) lưu trữ có cấu trúc bằng SQLite.

Khác với bộ nhớ ngắn hạn (cửa sổ ngữ cảnh của LLM, mất sau mỗi phiên), bộ nhớ
dài hạn ở đây lưu tri thức qua nhiều phiên kiểm thử: kỹ thuật khai thác đã thành
công theo từng nhóm lỗ hổng, sơ đồ bề mặt tấn công (endpoint) của mục tiêu thu
được từ giai đoạn Reconnaissance, và các phát hiện trước đó. Trước mỗi lần quét,
Agent truy hồi (recall) tri thức liên quan đến host để hỗ trợ khâu lập kế hoạch,
nhờ đó tránh lặp lại các bước vô ích và kết nối thông tin giữa các phiên.
"""
import sqlite3
from pathlib import Path
from urllib.parse import urlparse

TECHNIQUE = {
    "SQL Injection": "SQLi: thử dấu nháy đơn và cặp predicate boolean (true/false)",
    "Potential SQL Injection": "SQLi: thử dấu nháy đơn và cặp predicate boolean (true/false)",
    "Reflected XSS": "XSS: chèn marker <script>/<img onerror> và kiểm tra phản chiếu",
    "Stored XSS": "Stored XSS: lưu marker rồi đọc lại ở yêu cầu độc lập",
    "DOM XSS": "DOM XSS: xác nhận bằng oracle trình duyệt (alert marker)",
    "Potential BOLA/IDOR": "BOLA: so sánh hai phiên người dùng trên cùng một đối tượng",
    "Security Misconfiguration": "Kiểm thụ động security headers và endpoint/file nhạy cảm",
    "Software Supply Chain Exposure": "Kiểm phiên bản thành phần lộ qua header",
    "Cryptographic Failures": "Kiểm cờ cookie và lớp vận chuyển (HSTS)",
    "Authentication Failures": "Thử credential mặc định và quan sát cơ chế khóa đăng nhập",
}


def _host(url: str) -> str:
    parsed = urlparse(url)
    host = parsed.hostname or ""
    if parsed.port:
        host += f":{parsed.port}"
    return host


class LongTermMemory:
    def __init__(self, database_path: str = "data/sentinel.sqlite3"):
        self.database_path = Path(database_path)
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as c:
            c.execute(
                "CREATE TABLE IF NOT EXISTS ltm_knowledge ("
                "host TEXT NOT NULL, category TEXT NOT NULL, url_path TEXT NOT NULL,"
                "parameter TEXT, technique TEXT, hits INTEGER NOT NULL DEFAULT 1,"
                "last_seen TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,"
                "PRIMARY KEY (host, category, url_path, parameter))")
            c.execute(
                "CREATE TABLE IF NOT EXISTS ltm_surface ("
                "host TEXT NOT NULL, url_path TEXT NOT NULL, kind TEXT NOT NULL,"
                "PRIMARY KEY (host, url_path, kind))")
            c.execute(
                "CREATE TABLE IF NOT EXISTS ltm_scans (host TEXT PRIMARY KEY, scans INTEGER NOT NULL DEFAULT 0)")

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.database_path)
        conn.row_factory = sqlite3.Row
        return conn

    def remember(self, target_url: str, findings: list, pages: list | None = None) -> None:
        """Ghi tri thức sau một phiên: phát hiện đã xác nhận + sơ đồ bề mặt tấn công."""
        host = _host(target_url)
        with self._connect() as c:
            c.execute("INSERT INTO ltm_scans(host, scans) VALUES(?,1) "
                      "ON CONFLICT(host) DO UPDATE SET scans = scans + 1", (host,))
            for f in findings:
                path = urlparse(f.url).path or "/"
                technique = TECHNIQUE.get(f.category, f.category)
                c.execute(
                    "INSERT INTO ltm_knowledge(host, category, url_path, parameter, technique) "
                    "VALUES(?,?,?,?,?) ON CONFLICT(host, category, url_path, parameter) "
                    "DO UPDATE SET hits = hits + 1, last_seen = CURRENT_TIMESTAMP",
                    (host, f.category, path, f.parameter or "", technique))
            for page in (pages or []):
                for ep in page.get("endpoints", []):
                    c.execute("INSERT OR IGNORE INTO ltm_surface(host, url_path, kind) VALUES(?,?,?)",
                              (host, urlparse(ep.get("url", "")).path or "/", "endpoint"))
                for form in page.get("forms", []):
                    c.execute("INSERT OR IGNORE INTO ltm_surface(host, url_path, kind) VALUES(?,?,?)",
                              (host, urlparse(form.get("action", "")).path or "/", "form"))

    def recall(self, target_url: str) -> dict:
        """Truy hồi tri thức đã biết về host để hỗ trợ lập kế hoạch."""
        host = _host(target_url)
        with self._connect() as c:
            scans = c.execute("SELECT scans FROM ltm_scans WHERE host=?", (host,)).fetchone()
            known = c.execute(
                "SELECT category, url_path, parameter, technique, hits FROM ltm_knowledge "
                "WHERE host=? ORDER BY hits DESC LIMIT 32", (host,)).fetchall()
            surface = c.execute(
                "SELECT url_path, kind FROM ltm_surface WHERE host=? LIMIT 64", (host,)).fetchall()
        return {
            "host": host,
            "scans_seen": scans["scans"] if scans else 0,
            "known_findings": [
                {"category": r["category"], "path": r["url_path"],
                 "parameter": r["parameter"] or None, "technique": r["technique"], "hits": r["hits"]}
                for r in known],
            "known_surface": [{"path": r["url_path"], "kind": r["kind"]} for r in surface],
        }
