"""Xuất mỗi lần quét trong lịch sử thành một file báo cáo tiếng Việt riêng.

Tạo thư mục reports/ gồm:
  - index.html                : trang lịch sử (bảng liệt kê + link)
  - bao-cao-<scan_id>.html     : báo cáo tiếng Việt của từng lần quét

Dùng: python scripts/export_reports.py [--out reports]
"""
import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from app.repository import ScanRepository
from app.report_vi import render_vietnamese_report, render_history_vi


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=ROOT / "reports")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    scans = ScanRepository().list()
    for scan in scans:
        (args.out / f"bao-cao-{scan.scan_id}.html").write_text(
            render_vietnamese_report(scan), encoding="utf-8")
    # Trang lịch sử trỏ tới các file cục bộ (mở offline không cần server).
    (args.out / "index.html").write_text(
        render_history_vi(scans, href_template="bao-cao-{sid}.html"), encoding="utf-8")

    print(f"Đã xuất {len(scans)} báo cáo vào: {args.out}")
    print(f"Mở trang lịch sử: {args.out / 'index.html'}")


if __name__ == "__main__":
    main()
