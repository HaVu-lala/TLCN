"""Kho lưu kết quả quét (persistence) bằng SQLite.

Mỗi :class:`ScanResult` được lưu nguyên vẹn dưới dạng JSON trong một hàng của bảng
``scans``, nhờ đó giao diện có thể liệt kê lịch sử và mở lại báo cáo của từng lần
quét sau này.
"""
import json
import sqlite3
from pathlib import Path

from app.schemas import ScanResult


class ScanRepository:
    """Đọc/ghi kết quả quét vào cơ sở dữ liệu SQLite."""

    def __init__(self, database_path: str = "data/sentinel.sqlite3"):
        """Mở (hoặc tạo) cơ sở dữ liệu và bảng ``scans`` nếu chưa có."""
        self.database_path = Path(database_path)
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            connection.execute(
                "CREATE TABLE IF NOT EXISTS scans (scan_id TEXT PRIMARY KEY, target_url TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, payload TEXT NOT NULL)"
            )

    def _connect(self) -> sqlite3.Connection:
        """Tạo kết nối SQLite với row_factory để truy cập cột theo tên."""
        connection = sqlite3.connect(self.database_path)
        connection.row_factory = sqlite3.Row
        return connection

    def save(self, result: ScanResult) -> None:
        """Lưu (hoặc ghi đè) một kết quả quét theo ``scan_id``."""
        with self._connect() as connection:
            connection.execute(
                "INSERT OR REPLACE INTO scans (scan_id, target_url, payload) VALUES (?, ?, ?)",
                (result.scan_id, result.target_url, json.dumps(result.model_dump())),
            )

    def get(self, scan_id: str) -> ScanResult | None:
        """Lấy một kết quả quét theo ``scan_id``; trả ``None`` nếu không tồn tại."""
        with self._connect() as connection:
            row = connection.execute("SELECT payload FROM scans WHERE scan_id = ?", (scan_id,)).fetchone()
        return ScanResult.model_validate(json.loads(row["payload"])) if row else None

    def list(self) -> list[ScanResult]:
        """Liệt kê mọi kết quả quét, mới nhất trước."""
        with self._connect() as connection:
            rows = connection.execute("SELECT payload FROM scans ORDER BY created_at DESC").fetchall()
        return [ScanResult.model_validate(json.loads(row["payload"])) for row in rows]
