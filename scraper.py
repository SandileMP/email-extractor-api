import re
import logging
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
}

CONTACT_PATHS = ["/contact", "/contact-us", "/contacts", "/contact_us", "/reach-us", "/about/contact"]

CONTACT_KEYWORDS = {"contact", "reach out", "get in touch", "contact us", "reach us", "write to us"}

EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b")

# Domains commonly found in obfuscated anti-scraping patterns that aren't real emails
JUNK_EMAIL_DOMAINS = {"sentry.io", "wixpress.com"}

TIMEOUT = 10
MAX_REDIRECTS = 5


def _fetch(url: str, session: requests.Session) -> requests.Response | None:
    try:
        resp = session.get(url, headers=HEADERS, timeout=TIMEOUT, allow_redirects=True)
        resp.raise_for_status()
        return resp
    except requests.exceptions.RequestException as exc:
        logger.debug("Failed to fetch %s: %s", url, exc)
        return None


def _parse_emails(soup: BeautifulSoup) -> set[str]:
    emails: set[str] = set()

    # mailto: links first — most reliable
    for tag in soup.find_all("a", href=True):
        href: str = tag["href"]
        if href.lower().startswith("mailto:"):
            # strip query params (e.g. ?subject=Hello)
            address = href[7:].split("?")[0].strip()
            if EMAIL_RE.fullmatch(address):
                emails.add(address.lower())

    # regex over visible text
    text = soup.get_text(separator=" ")
    for match in EMAIL_RE.findall(text):
        emails.add(match.lower())

    # filter junk
    return {e for e in emails if e.split("@")[1] not in JUNK_EMAIL_DOMAINS}


def _find_contact_link(soup: BeautifulSoup, base_url: str) -> str | None:
    for tag in soup.find_all("a", href=True):
        label = (
            tag.get_text(strip=True).lower()
            or tag.get("aria-label", "").lower()
            or tag.get("title", "").lower()
        )
        if any(kw in label for kw in CONTACT_KEYWORDS):
            href = tag["href"].strip()
            if href and not href.startswith(("#", "javascript:")):
                return urljoin(base_url, href)
    return None


def _base_url(url: str) -> str:
    parsed = urlparse(url)
    return f"{parsed.scheme}://{parsed.netloc}"


def extract_emails(url: str) -> list[str]:
    """Return a deduplicated list of email addresses found for *url*."""
    with requests.Session() as session:
        session.max_redirects = MAX_REDIRECTS

        # Fetch the main page
        main_resp = _fetch(url, session)
        if main_resp is None:
            return []

        main_soup = BeautifulSoup(main_resp.content, "html.parser")
        base = _base_url(main_resp.url)  # use final URL after redirects

        # Collect emails from main page as a fallback
        main_emails = _parse_emails(main_soup)

        # Strategy 1: try known contact path suffixes
        for path in CONTACT_PATHS:
            candidate = urljoin(base, path)
            if candidate == main_resp.url:
                continue  # already on this page
            resp = _fetch(candidate, session)
            if resp is None:
                continue
            emails = _parse_emails(BeautifulSoup(resp.content, "html.parser"))
            if emails:
                return sorted(emails)

        # Strategy 2: follow a "contact us" link discovered in navigation
        contact_url = _find_contact_link(main_soup, base)
        if contact_url and contact_url != main_resp.url:
            resp = _fetch(contact_url, session)
            if resp is not None:
                emails = _parse_emails(BeautifulSoup(resp.content, "html.parser"))
                if emails:
                    return sorted(emails)

        # Strategy 3: fall back to main page emails
        if main_emails:
            return sorted(main_emails)

    return []
