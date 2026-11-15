"""Scope Guard: chỉ cho phép quét trong phạm vi được cấp phép.

Đây là rào an toàn quan trọng nhất về mặt đạo đức/pháp lý: mọi mục tiêu phải được
người dùng xác nhận là lab hợp pháp VÀ phải nằm trong danh sách host cho phép
(``ALLOWED_TARGET_HOSTS``) hoặc là địa chỉ nội bộ/loopback. URL ngoài phạm vi bị
từ chối ngay trước khi gửi bất kỳ yêu cầu nào.
"""
from ipaddress import ip_address
from urllib.parse import urlparse

from app.config import settings


class ScopeError(ValueError):
    """Ném ra khi mục tiêu (hoặc một redirect) nằm ngoài phạm vi cho phép."""


def validate_target(url: str, authorized: bool) -> str:
    """Kiểm tra và chuẩn hóa URL mục tiêu; ném :class:`ScopeError` nếu ngoài phạm vi.

    Quy tắc chấp nhận:
      1. Người dùng phải xác nhận ``authorized=True`` (đồng ý đây là lab hợp pháp).
      2. Lược đồ phải là http/https và có hostname.
      3. Hostname nằm trong danh sách cho phép, HOẶC là địa chỉ IP nội bộ/loopback.

    Trả về URL đã chuẩn hóa (bỏ dấu "/" thừa ở cuối đường dẫn).
    """
    if not authorized:
        raise ScopeError("You must confirm that the target is an authorized lab.")
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ScopeError("Target must be an HTTP or HTTPS URL.")
    hostname = parsed.hostname.lower()

    # Host nằm trong allowlist -> chấp nhận.
    if hostname in settings.allowed_hosts:
        normalized_path = parsed.path.rstrip("/") or "/"
        return parsed._replace(path=normalized_path).geturl()

    # Nếu hostname là một địa chỉ IP nội bộ hoặc loopback -> chấp nhận (lab cục bộ).
    try:
        address = ip_address(hostname)
    except ValueError:
        address = None
    if address and (address.is_private or address.is_loopback):
        normalized_path = parsed.path.rstrip("/") or "/"
        return parsed._replace(path=normalized_path).geturl()

    raise ScopeError("Target is outside the default lab scope. Add its host to ALLOWED_TARGET_HOSTS.")
