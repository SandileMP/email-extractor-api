"""
Integration tests that run against the deployed Lambda endpoint.
Requires API_URL env var, e.g.:
    API_URL=https://abc123.execute-api.eu-west-1.amazonaws.com pytest test_integration.py -v
"""

import os

import pytest
import requests

API_URL = os.environ.get("API_URL", "").rstrip("/")

if not API_URL:
    pytest.skip("API_URL not set — skipping integration tests", allow_module_level=True)


def post_emails(urls: list[str], timeout: int = 60) -> requests.Response:
    return requests.post(f"{API_URL}/emails", json={"urls": urls}, timeout=timeout)


class TestHealthEndpoint:
    def test_health_returns_200(self):
        r = requests.get(f"{API_URL}/health", timeout=10)
        assert r.status_code == 200

    def test_health_body(self):
        r = requests.get(f"{API_URL}/health", timeout=10)
        assert r.json().get("status") == "ok"


class TestEmailsEndpointLive:
    def test_returns_200_for_valid_url(self):
        r = post_emails(["https://example.com/"])
        assert r.status_code == 200

    def test_response_schema(self):
        r = post_emails(["https://example.com/"])
        body = r.json()
        assert "emails" in body
        assert isinstance(body["emails"], dict)

    def test_url_key_present_in_response(self):
        url = "https://example.com/"
        r = post_emails([url])
        assert url in r.json()["emails"]

    def test_example_email(self):
        r = post_emails(["https://example.com/"])
        emails = r.json()["emails"].get("https://example.com/", [])
        assert isinstance(emails, list)
        assert len(emails) > 0, "Expected at least one email for example.com"
        assert any("example.com" in e for e in emails)

    def test_acme_email(self):
        r = post_emails(["https://acme.co.za/"])
        emails = r.json()["emails"].get("https://acme.co.za/", [])
        assert isinstance(emails, list)
        assert len(emails) > 0, "Expected at least one email for acme.co.za"

    def test_multiple_urls(self):
        urls = ["https://example.com/", "https://acme.co.za/"]
        r = post_emails(urls)
        assert r.status_code == 200
        body = r.json()["emails"]
        for url in urls:
            assert url in body
            assert isinstance(body[url], list)

    def test_invalid_url_returns_422(self):
        r = post_emails(["not-a-url"])
        assert r.status_code == 422

    def test_empty_list_returns_422(self):
        r = post_emails([])
        assert r.status_code == 422

    def test_unreachable_url_returns_empty_list(self):
        r = post_emails(["https://this-domain-does-not-exist-xyz123.com/"])
        assert r.status_code == 200
        emails = r.json()["emails"]
        assert list(emails.values())[0] == []

    def test_response_emails_are_lists(self):
        urls = ["https://example.com/", "https://httpbin.org/html"]
        r = post_emails(urls)
        for _url, email_list in r.json()["emails"].items():
            assert isinstance(email_list, list)

    def test_emails_are_valid_format(self):
        import re
        pattern = re.compile(r"^[^@]+@[^@]+\.[^@]+$")
        r = post_emails(["https://example.com/"])
        for _url, email_list in r.json()["emails"].items():
            for email in email_list:
                assert pattern.match(email), f"Not a valid email: {email}"
