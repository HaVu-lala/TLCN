import json
import sqlite3
from pathlib import Path

from app.schemas import ScanResult


class ScanRepository:
    def __init__(self, database_path: str = "data/sentinel.sqlite3"):
        self.database_path = Path(database_path)
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            connection.execute(
                "CREATE TABLE IF NOT EXISTS scans (scan_id TEXT PRIMARY KEY, target_url TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, payload TEXT NOT NULL)"
            )

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path)
        connection.row_factory = sqlite3.Row
        return connection

    def save(self, result: ScanResult) -> None:
        with self._connect() as connection:
            connection.execute(
                "INSERT OR REPLACE INTO scans (scan_id, target_url, payload) VALUES (?, ?, ?)",
                (result.scan_id, result.target_url, json.dumps(result.model_dump())),
            )

    def get(self, scan_id: str) -> ScanResult | None:
        with self._connect() as connection:
            row = connection.execute("SELECT payload FROM scans WHERE scan_id = ?", (scan_id,)).fetchone()
        return ScanResult.model_validate(json.loads(row["payload"])) if row else None

    def list(self) -> list[ScanResult]:
        with self._connect() as connection:
            rows = connection.execute("SELECT payload FROM scans ORDER BY created_at DESC").fetchall()
        return [ScanResult.model_validate(json.loads(row["payload"])) for row in rows]
