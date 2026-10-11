from ipaddress import ip_address
from urllib.parse import urlparse

from app.config import settings


class ScopeError(ValueError):
    pass


def validate_target(url: str, authorized: bool) -> str:
    if not authorized:
        raise ScopeError("You must confirm that the target is an authorized lab.")
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ScopeError("Target must be an HTTP or HTTPS URL.")
    hostname = parsed.hostname.lower()
    if hostname in settings.allowed_hosts:
        normalized_path = parsed.path.rstrip("/") or "/"
        return parsed._replace(path=normalized_path).geturl()
    try:
        address = ip_address(hostname)
    except ValueError:
        address = None
    if address and (address.is_private or address.is_loopback):
        normalized_path = parsed.path.rstrip("/") or "/"
        return parsed._replace(path=normalized_path).geturl()
    raise ScopeError("Target is outside the default lab scope. Add its host to ALLOWED_TARGET_HOSTS.")
