import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urlparse

from fastapi import FastAPI
from fastapi.openapi.utils import get_openapi
from mangum import Mangum
from pydantic import BaseModel, Field, field_validator

from scraper import extract_emails

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Email Extractor API",
    description=(
        "Scrapes one or more websites and returns the email addresses found on each.\n\n"
        "### Extraction strategy\n"
        "For each URL the scraper tries, in order:\n"
        "1. Common contact-page paths (`/contact`, `/contact-us`, `/contacts`, …)\n"
        "2. A navigation link whose text or `aria-label` contains *contact*, *reach out*, *get in touch*, etc.\n"
        "3. Emails found on the main page itself (fallback)\n\n"
        "Both `mailto:` href attributes and plain-text regex matches are used. "
        "Results are lowercased, deduplicated, and sorted alphabetically.\n\n"
        "### Limits\n"
        "- Maximum **50 URLs** per request\n"
        "- Per-URL HTTP timeout: **10 seconds**\n"
        "- Lambda execution timeout: **60 seconds**\n\n"
        "### Error behaviour\n"
        "Network errors, DNS failures, and HTTP 4xx/5xx responses are handled gracefully — "
        "the offending URL is returned with an empty list rather than failing the whole request."
    ),
    version="1.0.0",
    contact={
        "name": "SandileMP",
        "url": "https://github.com/SandileMP/email-extractor-api",
    },
    license_info={
        "name": "MIT",
        "url": "https://opensource.org/licenses/MIT",
    },
    openapi_tags=[
        {
            "name": "Email extraction",
            "description": "Scrape email addresses from websites.",
        },
        {
            "name": "Operations",
            "description": "Health and liveness checks.",
        },
    ],
)

MAX_URLS = 50
MAX_WORKERS = 10


class EmailRequest(BaseModel):
    urls: list[str] = Field(
        ...,
        min_length=1,
        description="List of website URLs to scrape (1–50 entries, http/https only).",
        examples=[["https://marble.restaurant/", "https://www.aurumrestaurant.co.za/"]],
    )

    @field_validator("urls")
    @classmethod
    def validate_urls(cls, v: list[str]) -> list[str]:
        if not v:
            raise ValueError("urls list must not be empty")
        if len(v) > MAX_URLS:
            raise ValueError(f"urls list must not exceed {MAX_URLS} entries")
        for url in v:
            parsed = urlparse(url)
            if parsed.scheme not in {"http", "https"} or not parsed.netloc:
                raise ValueError(f"Invalid URL: {url!r}")
        return v

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "urls": [
                        "https://marble.restaurant/",
                        "https://www.aurumrestaurant.co.za/",
                    ]
                }
            ]
        }
    }


class EmailResponse(BaseModel):
    emails: dict[str, list[str]] = Field(
        ...,
        description=(
            "Map of input URL → sorted list of unique email addresses found. "
            "An empty list means no emails were discovered (or the site was unreachable)."
        ),
        examples=[
            {
                "https://marble.restaurant/": ["info@marble.restaurant"],
                "https://www.aurumrestaurant.co.za/": ["bookings@aurumrestaurant.co.za"],
            }
        ],
    )

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "emails": {
                        "https://marble.restaurant/": ["info@marble.restaurant"],
                        "https://www.aurumrestaurant.co.za/": [
                            "bookings@aurumrestaurant.co.za"
                        ],
                    }
                }
            ]
        }
    }


@app.post(
    "/emails",
    response_model=EmailResponse,
    tags=["Email extraction"],
    summary="Extract emails from websites",
    response_description="Email addresses grouped by input URL.",
    responses={
        200: {
            "description": "Emails extracted successfully (including URLs that returned empty lists).",
            "content": {
                "application/json": {
                    "example": {
                        "emails": {
                            "https://marble.restaurant/": ["info@marble.restaurant"],
                            "https://www.aurumrestaurant.co.za/": [
                                "bookings@aurumrestaurant.co.za"
                            ],
                        }
                    }
                }
            },
        },
        422: {"description": "Validation error — empty list, invalid URL, or > 50 URLs."},
    },
)
def get_emails(payload: EmailRequest) -> EmailResponse:
    """
    Submit a list of website URLs and receive the email addresses scraped from each.

    All URLs are fetched concurrently. Unreachable or email-free sites return an
    empty list for that key — they do **not** cause the whole request to fail.
    """
    url_strings = [str(u) for u in payload.urls]
    results: dict[str, list[str]] = {}

    with ThreadPoolExecutor(max_workers=min(MAX_WORKERS, len(url_strings))) as pool:
        future_to_url = {pool.submit(extract_emails, url): url for url in url_strings}
        for future in as_completed(future_to_url):
            url = future_to_url[future]
            try:
                results[url] = future.result()
            except Exception as exc:
                logger.error("Unexpected error for %s: %s", url, exc)
                results[url] = []

    return EmailResponse(emails=results)


@app.get(
    "/health",
    tags=["Operations"],
    summary="Health check",
    response_description="Service liveness status.",
    responses={200: {"content": {"application/json": {"example": {"status": "ok"}}}}},
)
def health() -> dict[str, str]:
    """Returns `{"status": "ok"}` when the service is running."""
    return {"status": "ok"}


# Lambda entrypoint
handler = Mangum(app, lifespan="off")
