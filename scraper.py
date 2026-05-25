import re
import time
import logging
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

logger = logging.getLogger("weblandr.scraper")

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
}

CONTACT_PATHS = [
    "/contact",
    "/contact-us",
    "/contacts",
    "/contact_us",
    "/reach-us",
    "/about/contact",
]

CONTACT_KEYWORDS = {
    "contact", "reach out", "get in touch", "contact us", "reach us", "write to us",
}

EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b")

# Domains commonly found in obfuscated anti-scraping patterns — not real emails
JUNK_EMAIL_DOMAINS = {"sentry.io", "wixpress.com"}

# (connect_timeout, read_timeout) — 3 s to establish connection, 5 s to receive body
TIMEOUT       = (3, 5)
MAX_REDIRECTS = 5


# ── Helpers ───────────────────────────────────────────────────────────────────

def _fetch(url: str, session: requests.Session, label: str = "") -> requests.Response | None:
    """Fetch *url* and return the Response, or None on any error."""
    tag = label or url
    t0  = time.monotonic()
    try:
        resp = session.get(url, headers=HEADERS, timeout=TIMEOUT, allow_redirects=True)
        resp.raise_for_status()
        elapsed = (time.monotonic() - t0) * 1000
        logger.debug(
            "  GET %s → HTTP %d (%.0f ms, %d bytes)",
            tag, resp.status_code, elapsed, len(resp.content),
        )
        return resp
    except requests.exceptions.ConnectionError as exc:
        logger.debug("  GET %s → connection error: %s", tag, exc)
    except requests.exceptions.Timeout:
        elapsed = (time.monotonic() - t0) * 1000
        logger.debug("  GET %s → timed out after %.0f ms", tag, elapsed)
    except requests.exceptions.HTTPError as exc:
        logger.debug("  GET %s → HTTP error: %s", tag, exc)
    except requests.exceptions.RequestException as exc:
        logger.debug("  GET %s → request error: %s", tag, exc)
    return None


def _parse_emails(soup: BeautifulSoup) -> set[str]:
    """Extract all valid email addresses from *soup*."""
    emails: set[str] = set()

    # 1. mailto: links — most reliable signal
    for tag in soup.find_all("a", href=True):
        href: str = tag["href"]
        if href.lower().startswith("mailto:"):
            address = href[7:].split("?")[0].strip()
            if EMAIL_RE.fullmatch(address):
                emails.add(address.lower())

    # 2. Regex over visible text — catches plain-text addresses
    text = soup.get_text(separator=" ")
    for match in EMAIL_RE.findall(text):
        emails.add(match.lower())

    # 3. Filter known junk domains
    clean = {e for e in emails if e.split("@")[1] not in JUNK_EMAIL_DOMAINS}
    return clean


def _find_contact_link(soup: BeautifulSoup, base_url: str) -> str | None:
    """Find an <a> whose visible text/aria-label suggests a contact page."""
    for tag in soup.find_all("a", href=True):
        label = (
            tag.get_text(strip=True).lower()
            or tag.get("aria-label", "").lower()
            or tag.get("title", "").lower()
        )
        if any(kw in label for kw in CONTACT_KEYWORDS):
            href = tag["href"].strip()
            if href and not href.startswith(("#", "javascript:")):
                resolved = urljoin(base_url, href)
                logger.debug("  Found contact link in nav: %s → %s", label, resolved)
                return resolved
    return None


def _base_url(url: str) -> str:
    parsed = urlparse(url)
    return f"{parsed.scheme}://{parsed.netloc}"


# ── Main entry point ──────────────────────────────────────────────────────────

def extract_emails(url: str) -> list[str]:
    """
    Return a deduplicated, sorted list of email addresses found for *url*.

    Strategy (stops as soon as emails are found):
      1. Probe known contact-page paths (/contact, /contact-us, …)
      2. Follow a "contact us" nav link discovered on the main page
      3. Fall back to emails on the main page itself
    """
    t_start = time.monotonic()
    logger.info("→ Starting extraction: %s", url)

    with requests.Session() as session:
        session.max_redirects = MAX_REDIRECTS

        # ── Step 0: fetch main page ──────────────────────────────────────────
        main_resp = _fetch(url, session, label="[main page]")
        if main_resp is None:
            elapsed = (time.monotonic() - t_start) * 1000
            logger.info("← %s — unreachable (%.0f ms)", url, elapsed)
            return []

        final_url = main_resp.url  # may differ after redirects
        if final_url != url:
            logger.debug("  Followed redirect: %s → %s", url, final_url)

        main_soup  = BeautifulSoup(main_resp.content, "html.parser")
        base       = _base_url(final_url)
        main_emails = _parse_emails(main_soup)

        if main_emails:
            logger.debug("  Main page has %d email(s) (kept as fallback)", len(main_emails))

        # ── Step 1: probe known contact paths ────────────────────────────────
        logger.debug("  Probing %d contact path(s)…", len(CONTACT_PATHS))
        for path in CONTACT_PATHS:
            candidate = urljoin(base, path)
            if candidate == final_url:
                logger.debug("  Skipping %s (same as main page)", path)
                continue

            resp = _fetch(candidate, session, label=path)
            if resp is None:
                continue

            emails = _parse_emails(BeautifulSoup(resp.content, "html.parser"))
            if emails:
                elapsed = (time.monotonic() - t_start) * 1000
                logger.info(
                    "← %s — %d email(s) via contact path %s (%.0f ms): %s",
                    url, len(emails), path, elapsed, sorted(emails),
                )
                return sorted(emails)

        # ── Step 2: follow nav "contact us" link ─────────────────────────────
        contact_link = _find_contact_link(main_soup, base)
        if contact_link and contact_link != final_url:
            resp = _fetch(contact_link, session, label="[contact link]")
            if resp is not None:
                emails = _parse_emails(BeautifulSoup(resp.content, "html.parser"))
                if emails:
                    elapsed = (time.monotonic() - t_start) * 1000
                    logger.info(
                        "← %s — %d email(s) via nav contact link (%.0f ms): %s",
                        url, len(emails), elapsed, sorted(emails),
                    )
                    return sorted(emails)
        elif not contact_link:
            logger.debug("  No contact link found in navigation")

        # ── Step 3: fall back to main page emails ────────────────────────────
        if main_emails:
            elapsed = (time.monotonic() - t_start) * 1000
            logger.info(
                "← %s — %d email(s) from main page fallback (%.0f ms): %s",
                url, len(main_emails), elapsed, sorted(main_emails),
            )
            return sorted(main_emails)

        elapsed = (time.monotonic() - t_start) * 1000
        logger.info("← %s — no emails found (%.0f ms)", url, elapsed)
        return []
