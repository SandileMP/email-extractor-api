import logging
import os
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed, TimeoutError as FutureTimeoutError
from datetime import datetime, timezone, timedelta
from urllib.parse import urlparse

import boto3
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi
from mangum import Mangum
from pydantic import BaseModel, Field, field_validator

from scraper import extract_emails

# Persist extractions so users can reference them in campaigns
_dynamo = None
def _get_table():
    global _dynamo
    if _dynamo is None:
        table_name = os.environ.get("EXTRACTIONS_TABLE", "")
        if table_name:
            _dynamo = boto3.resource("dynamodb", region_name=os.environ.get("AWS_REGION","eu-west-1")).Table(table_name)
    return _dynamo

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
        "- Maximum **25 URLs** per request\n"
        "- Per-URL HTTP timeout: **5 seconds** read / **3 seconds** connect\n"
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-API-Key"],
    max_age=300,
)

MAX_URLS    = 25   # keep each Lambda invocation well within API GW's 29 s timeout
MAX_WORKERS = 25   # all URLs in a batch run concurrently
OVERALL_S   = 22   # hard wall-clock budget per request (leaves 7 s buffer before 29 s)


class EmailRequest(BaseModel):
    urls: list[str] = Field(
        ...,
        min_length=1,
        description="List of website URLs to scrape (1–50 entries, http/https only).",
        examples=[["https://example.com/", "https://acme.co.za/"]],
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
                        "https://example.com/",
                        "https://acme.co.za/",
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
                "https://example.com/": ["hello@example.com"],
                "https://acme.co.za/": ["info@acme.co.za"],
            }
        ],
    )

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "emails": {
                        "https://example.com/": ["hello@example.com"],
                        "https://acme.co.za/": ["info@acme.co.za"],
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
                            "https://example.com/": ["hello@example.com"],
                            "https://acme.co.za/": ["info@acme.co.za"],
                        }
                    }
                }
            },
        },
        422: {"description": "Validation error — empty list, invalid URL, or > 25 URLs."},
    },
)
def get_emails(payload: EmailRequest, request: Request) -> EmailResponse:
    """
    Submit a list of website URLs and receive the email addresses scraped from each.

    All URLs are fetched concurrently. Unreachable or email-free sites return an
    empty list for that key — they do **not** cause the whole request to fail.
    """
    url_strings = [str(u) for u in payload.urls]
    results: dict[str, list[str]] = {}
    deadline = time.monotonic() + OVERALL_S

    with ThreadPoolExecutor(max_workers=min(MAX_WORKERS, len(url_strings))) as pool:
        future_to_url = {pool.submit(extract_emails, url): url for url in url_strings}
        for future in as_completed(future_to_url):
            url = future_to_url[future]
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                logger.warning("Budget exhausted, skipping %s", url)
                results[url] = []
                continue
            try:
                results[url] = future.result(timeout=remaining)
            except FutureTimeoutError:
                logger.warning("Per-URL budget exceeded for %s", url)
                results[url] = []
            except Exception as exc:
                logger.error("Unexpected error for %s: %s", url, exc)
                results[url] = []

    # Ensure every requested URL appears in the response
    for u in url_strings:
        results.setdefault(u, [])

    # Persist extraction so users can reference results in campaigns
    _persist_extraction(request, results)

    return EmailResponse(emails=results)


def _persist_extraction(request: Request, emails: dict[str, list[str]]) -> None:
    try:
        table = _get_table()
        if not table:
            return
        user_id = ""
        # Pull user_email from Lambda authorizer context (injected by API Gateway)
        scope = request.scope
        aws_event = scope.get("aws.event", {})
        user_id = (aws_event.get("requestContext", {})
                             .get("authorizer", {})
                             .get("lambda", {})
                             .get("user_email", ""))
        if not user_id:
            return

        email_count = sum(len(v) for v in emails.values())
        expires = int((datetime.now(timezone.utc) + timedelta(days=30)).timestamp())

        table.put_item(Item={
            "extraction_id": str(uuid.uuid4()),
            "user_id":       user_id,
            "urls":          list(emails.keys()),
            "emails":        emails,
            "email_count":   email_count,
            "created_at":    datetime.now(timezone.utc).isoformat(),
            "expires_at":    expires,
        })
    except Exception as exc:
        logger.warning("Could not persist extraction: %s", exc)


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
