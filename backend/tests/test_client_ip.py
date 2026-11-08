from starlette.requests import Request

from app.core.config import settings
from app.core.deps import client_ip


def make_request(peer: str, forwarded: str | None = None) -> Request:
    headers = []
    if forwarded is not None:
        headers.append((b"x-forwarded-for", forwarded.encode()))
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/",
            "headers": headers,
            "client": (peer, 1234),
            "server": ("testserver", 80),
            "scheme": "http",
            "query_string": b"",
            "http_version": "1.1",
        }
    )


def test_forwarded_for_is_only_trusted_from_configured_proxies(monkeypatch):
    monkeypatch.setattr(settings, "trusted_proxies", "")
    assert client_ip(make_request("203.0.113.9", "198.51.100.7")) == "203.0.113.9"

    monkeypatch.setattr(settings, "trusted_proxies", "203.0.113.0/24")
    spoofed_chain = "1.2.3.4, 198.51.100.7"
    assert client_ip(make_request("203.0.113.9", spoofed_chain)) == "198.51.100.7"
    assert client_ip(make_request("203.0.113.9", "not-an-ip")) == "203.0.113.9"
