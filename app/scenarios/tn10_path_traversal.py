"""[Kịch bản 10 - TN10] Path Traversal (duyệt thư mục).

- Generic: tiêm chuỗi duyệt ngược vào tham số tên tệp/đường dẫn, oracle kiểm chữ
  ký /etc/passwd. Logic ở app/path_traversal.py.
- Ghim theo lab: Juice Shop /ftp vượt bộ lọc bằng null-byte. app/labs.py.
"""
from app.detectors import DetectorContext, register
from app.labs import lab_path_traversal_checks
from app.path_traversal import check_path_traversal


@register("Path Traversal (active, /etc/passwd oracle)")
def path_traversal(ctx: DetectorContext):
    return check_path_traversal(ctx.tools, ctx.pages)


@register("Path Traversal (lab-pinned)")
def path_traversal_lab(ctx: DetectorContext):
    return lab_path_traversal_checks(ctx.tools, ctx.pages)
