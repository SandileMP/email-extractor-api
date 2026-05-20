"""
Unit tests for the Email Extractor API.

Coverage:
- POST /emails happy path (emails found on main page, contact page, via contact link)
- POST /emails error cases (network error, no emails, invalid input)
- scraper.extract_emails internals (mailto links, regex, dedup, junk filtering)
- FastAPI validation (empty list, too many URLs, non-URL strings)
"""

import re

import pytest
import responses as resp_lib
from bs4 import BeautifulSoup
from fastapi.testclient import TestClient

from main import app
from scraper import (
    EMAIL_RE,
    _find_contact_link,
    _parse_emails,
    extract_emails,
)

client = TestClient(app)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def html(body: str) -> str:
    return f"<html><body>{body}</body></html>"


def make_soup(body: str) -> BeautifulSoup:
    return BeautifulSoup(html(body), "html.parser")


# ---------------------------------------------------------------------------
# Unit tests: _parse_emails
# ---------------------------------------------------------------------------

class TestParseEmails:
    def test_mailto_link(self):
        soup = make_soup('<a href="mailto:hello@realsite.org">Email us</a>')
        assert "hello@realsite.org" in _parse_emails(soup)

    def test_mailto_with_query_string(self):
        soup = make_soup('<a href="mailto:hi@site.com?subject=Hello">contact</a>')
        assert "hi@site.com" in _parse_emails(soup)

    def test_regex_in_plain_text(self):
        soup = make_soup("<p>Reach us at info@company.io for support.</p>")
        assert "info@company.io" in _parse_emails(soup)

    def test_deduplication(self):
        soup = make_soup(
            '<a href="mailto:dup@test.com">one</a>'
            "<p>Also: dup@test.com</p>"
        )
        results = _parse_emails(soup)
        assert len([e for e in results if e == "dup@test.com"]) == 1

    def test_junk_domain_filtered(self):
        soup = make_soup("<p>Error sent to ops@sentry.io daily.</p>")
        assert "ops@sentry.io" not in _parse_emails(soup)

    def test_no_emails(self):
        soup = make_soup("<p>No contact info here.</p>")
        assert _parse_emails(soup) == set()

    def test_multiple_emails(self):
        soup = make_soup(
            '<a href="mailto:a@foo.com">A</a>'
            '<a href="mailto:b@bar.org">B</a>'
        )
        results = _parse_emails(soup)
        assert "a@foo.com" in results
        assert "b@bar.org" in results

    def test_emails_are_lowercased(self):
        soup = make_soup("<p>Contact SALES@Company.COM for info.</p>")
        assert "sales@company.com" in _parse_emails(soup)

    def test_invalid_email_not_matched(self):
        soup = make_soup("<p>version 2.0@3x is not an email</p>")
        # The regex should not capture things without a proper domain
        for email in _parse_emails(soup):
            assert "@" in email and "." in email.split("@")[1]


# ---------------------------------------------------------------------------
# Unit tests: _find_contact_link
# ---------------------------------------------------------------------------

class TestFindContactLink:
    BASE = "https://example.com"

    def test_contact_us_text(self):
        soup = make_soup('<a href="/contact">Contact Us</a>')
        assert _find_contact_link(soup, self.BASE) == "https://example.com/contact"

    def test_contact_text_case_insensitive(self):
        soup = make_soup('<a href="/contact-page">CONTACT</a>')
        assert _find_contact_link(soup, self.BASE) == "https://example.com/contact-page"

    def test_reach_out_text(self):
        soup = make_soup('<a href="/reach">Reach Out</a>')
        assert _find_contact_link(soup, self.BASE) == "https://example.com/reach"

    def test_get_in_touch_text(self):
        soup = make_soup('<a href="/touch">Get in Touch</a>')
        assert _find_contact_link(soup, self.BASE) == "https://example.com/touch"

    def test_aria_label(self):
        soup = make_soup('<a href="/c" aria-label="Contact Us"></a>')
        assert _find_contact_link(soup, self.BASE) == "https://example.com/c"

    def test_no_contact_link(self):
        soup = make_soup('<a href="/about">About Us</a>')
        assert _find_contact_link(soup, self.BASE) is None

    def test_absolute_href_preserved(self):
        soup = make_soup('<a href="https://other.com/contact">Contact</a>')
        result = _find_contact_link(soup, self.BASE)
        assert result == "https://other.com/contact"

    def test_javascript_href_skipped(self):
        soup = make_soup('<a href="javascript:void(0)">Contact</a>')
        assert _find_contact_link(soup, self.BASE) is None

    def test_anchor_href_skipped(self):
        soup = make_soup('<a href="#contact-section">Contact</a>')
        assert _find_contact_link(soup, self.BASE) is None


# ---------------------------------------------------------------------------
# Unit tests: EMAIL_RE
# ---------------------------------------------------------------------------

class TestEmailRegex:
    valid = [
        "user@example.com",
        "user.name+tag@sub.domain.org",
        "123@numbers.io",
        "x@y.co",
    ]
    invalid = [
        "notanemail",
        "@nodomain.com",
        "noatsign.com",
        "missing@",
        "bad@.com",
    ]

    def test_valid_emails(self):
        for email in self.valid:
            assert EMAIL_RE.search(email), f"Should match: {email}"

    def test_invalid_emails(self):
        for token in self.invalid:
            assert not EMAIL_RE.fullmatch(token), f"Should not fullmatch: {token}"


# ---------------------------------------------------------------------------
# Integration tests: extract_emails (with mocked HTTP)
# ---------------------------------------------------------------------------

class TestExtractEmails:
    TARGET = "https://target.com"

    @resp_lib.activate
    def test_email_on_main_page(self):
        resp_lib.add(resp_lib.GET, self.TARGET, body=html("<p>info@target.com</p>"), status=200)
        # contact paths all 404
        for path in ["/contact", "/contact-us", "/contacts", "/contact_us", "/reach-us", "/about/contact"]:
            resp_lib.add(resp_lib.GET, self.TARGET + path, status=404)
        result = extract_emails(self.TARGET)
        assert "info@target.com" in result

    @resp_lib.activate
    def test_email_on_contact_page(self):
        resp_lib.add(resp_lib.GET, self.TARGET, body=html("<p>Welcome</p>"), status=200)
        resp_lib.add(
            resp_lib.GET,
            self.TARGET + "/contact",
            body=html('<a href="mailto:support@target.com">Email</a>'),
            status=200,
        )
        result = extract_emails(self.TARGET)
        assert "support@target.com" in result

    @resp_lib.activate
    def test_follows_contact_link(self):
        resp_lib.add(
            resp_lib.GET,
            self.TARGET,
            body=html('<a href="/reach">Contact Us</a>'),
            status=200,
        )
        for path in ["/contact", "/contact-us", "/contacts", "/contact_us", "/reach-us", "/about/contact"]:
            resp_lib.add(resp_lib.GET, self.TARGET + path, status=404)
        resp_lib.add(
            resp_lib.GET,
            self.TARGET + "/reach",
            body=html("<p>hello@target.com</p>"),
            status=200,
        )
        result = extract_emails(self.TARGET)
        assert "hello@target.com" in result

    @resp_lib.activate
    def test_network_error_returns_empty(self):
        import requests as req
        resp_lib.add(resp_lib.GET, self.TARGET, body=req.exceptions.ConnectionError())
        result = extract_emails(self.TARGET)
        assert result == []

    @resp_lib.activate
    def test_404_main_page_returns_empty(self):
        resp_lib.add(resp_lib.GET, self.TARGET, status=404)
        result = extract_emails(self.TARGET)
        assert result == []

    @resp_lib.activate
    def test_no_emails_anywhere_returns_empty(self):
        resp_lib.add(resp_lib.GET, self.TARGET, body=html("<p>No info here.</p>"), status=200)
        for path in ["/contact", "/contact-us", "/contacts", "/contact_us", "/reach-us", "/about/contact"]:
            resp_lib.add(resp_lib.GET, self.TARGET + path, status=404)
        result = extract_emails(self.TARGET)
        assert result == []

    @resp_lib.activate
    def test_deduplication_across_pages(self):
        resp_lib.add(resp_lib.GET, self.TARGET, body=html("<p>Welcome</p>"), status=200)
        body = html(
            '<a href="mailto:dup@target.com">one</a>'
            "<p>Contact: dup@target.com</p>"
        )
        resp_lib.add(resp_lib.GET, self.TARGET + "/contact", body=body, status=200)
        result = extract_emails(self.TARGET)
        assert result.count("dup@target.com") == 1

    @resp_lib.activate
    def test_result_is_sorted(self):
        resp_lib.add(resp_lib.GET, self.TARGET, body=html("<p>Welcome</p>"), status=200)
        resp_lib.add(
            resp_lib.GET,
            self.TARGET + "/contact",
            body=html("<p>zebra@z.com alpha@a.com</p>"),
            status=200,
        )
        result = extract_emails(self.TARGET)
        assert result == sorted(result)


# ---------------------------------------------------------------------------
# API endpoint tests
# ---------------------------------------------------------------------------

class TestEmailsEndpoint:
    def test_health(self):
        r = client.get("/health")
        assert r.status_code == 200
        assert r.json() == {"status": "ok"}

    @resp_lib.activate
    def test_single_url_with_emails(self):
        url = "https://mysite.com"
        resp_lib.add(resp_lib.GET, url, body=html("<p>Welcome</p>"), status=200)
        resp_lib.add(resp_lib.GET, url + "/contact", body=html("<p>hi@mysite.com</p>"), status=200)

        r = client.post("/emails", json={"urls": [url]})
        assert r.status_code == 200
        data = r.json()
        assert "hi@mysite.com" in data["emails"][url]

    @resp_lib.activate
    def test_multiple_urls(self):
        url_a = "https://alpha.com"
        url_b = "https://beta.com"

        resp_lib.add(resp_lib.GET, url_a, body=html("<p>a@alpha.com</p>"), status=200)
        for path in ["/contact", "/contact-us", "/contacts", "/contact_us", "/reach-us", "/about/contact"]:
            resp_lib.add(resp_lib.GET, url_a + path, status=404)

        resp_lib.add(resp_lib.GET, url_b, body=html("<p>Welcome</p>"), status=200)
        resp_lib.add(resp_lib.GET, url_b + "/contact", body=html("<p>b@beta.com</p>"), status=200)

        r = client.post("/emails", json={"urls": [url_a, url_b]})
        assert r.status_code == 200
        emails = r.json()["emails"]
        assert "a@alpha.com" in emails[url_a]
        assert "b@beta.com" in emails[url_b]

    @resp_lib.activate
    def test_url_with_no_emails_returns_empty_list(self):
        url = "https://empty.com"
        resp_lib.add(resp_lib.GET, url, body=html("<p>Nothing here.</p>"), status=200)
        for path in ["/contact", "/contact-us", "/contacts", "/contact_us", "/reach-us", "/about/contact"]:
            resp_lib.add(resp_lib.GET, url + path, status=404)

        r = client.post("/emails", json={"urls": [url]})
        assert r.status_code == 200
        assert r.json()["emails"][url] == []

    @resp_lib.activate
    def test_network_error_returns_empty_list(self):
        import requests as req
        url = "https://down.com"
        resp_lib.add(resp_lib.GET, url, body=req.exceptions.ConnectionError())

        r = client.post("/emails", json={"urls": [url]})
        assert r.status_code == 200
        assert r.json()["emails"][url] == []

    def test_empty_urls_list_returns_422(self):
        r = client.post("/emails", json={"urls": []})
        assert r.status_code == 422

    def test_missing_urls_key_returns_422(self):
        r = client.post("/emails", json={"data": []})
        assert r.status_code == 422

    def test_invalid_url_returns_422(self):
        r = client.post("/emails", json={"urls": ["not-a-url"]})
        assert r.status_code == 422

    def test_too_many_urls_returns_422(self):
        urls = [f"https://site{i}.com" for i in range(51)]
        r = client.post("/emails", json={"urls": urls})
        assert r.status_code == 422

    def test_response_contains_all_requested_urls(self):
        """Every submitted URL must appear as a key in the response, even on error."""
        import requests as req

        url_a = "https://one.com"
        url_b = "https://two.com"

        with resp_lib.RequestsMock() as rsps:
            rsps.add(rsps.GET, url_a, body=req.exceptions.ConnectionError())
            rsps.add(rsps.GET, url_b, body=html("<p>contact@two.com</p>"), status=200)
            for path in ["/contact", "/contact-us", "/contacts", "/contact_us", "/reach-us", "/about/contact"]:
                rsps.add(rsps.GET, url_b + path, status=404)

            r = client.post("/emails", json={"urls": [url_a, url_b]})

        assert r.status_code == 200
        emails = r.json()["emails"]
        # Keys are the original strings as submitted (no normalization)
        assert url_a in emails
        assert url_b in emails

    def test_wrong_http_method_returns_405(self):
        r = client.get("/emails")
        assert r.status_code == 405

    @resp_lib.activate
    def test_trailing_slash_url_normalised(self):
        """FastAPI/Pydantic normalises https://site.com/ — verify it still works."""
        url = "https://trailslash.com/"
        resp_lib.add(resp_lib.GET, url, body=html("<p>info@trailslash.com</p>"), status=200)
        for path in ["/contact", "/contact-us", "/contacts", "/contact_us", "/reach-us", "/about/contact"]:
            resp_lib.add(resp_lib.GET, "https://trailslash.com" + path, status=404)
            resp_lib.add(resp_lib.GET, url + path.lstrip("/"), status=404)

        r = client.post("/emails", json={"urls": [url]})
        assert r.status_code == 200
