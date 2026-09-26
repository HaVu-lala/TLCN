import pytest

from app.scope import ScopeError, validate_target


def test_requires_authorization():
    with pytest.raises(ScopeError):
        validate_target("http://127.0.0.1:8000", False)


def test_allows_local_lab():
    assert validate_target("http://localhost:3000", True).startswith("http://localhost")


def test_rejects_public_target():
    with pytest.raises(ScopeError):
        validate_target("https://example.com", True)
