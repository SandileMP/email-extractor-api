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
from mangum import Mangum
from pydantic import BaseModel, Field, field_validator

from scraper import extract_emails

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("weblandr.extractor")

# ── DynamoDB (lazy init) ──────────────────────────────────────────────────────
_dynamo = None

def _get_table():
    global _dynamo
    if _dynamo is None:
        table_name = os.environ.get("EXTRACTIONS_TABLE", "")
        if table_name:
            _dynamo = boto3.resource(
                "dynamodb",
                region_name=os.environ.get("AWS_REGION", "eu-west-1"),
            ).Table(table_name)
            logger.info("DynamoDB table connected: %s", table_name)
        else:
            logger.warning("EXTRACTIONS_TABLE env var not set — extractions will not be persisted")
    return _dynamo


# ── FastAPI app ───────────────────────────────────────────────────────────────
app = FastAPI(
    title="Weblandr Email Extractor API",
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
        "- Hard wall-clock budget per request: **22 seconds** (API Gateway enforces 29 s)\n\n"
        "### Error behaviour\n"
        "Network errors, DNS failures, and HTTP 4xx/5xx responses are handled gracefully — "
        "the offending URL is returned with an empty list rather than failing the whole request."
    ),
    version="1.1.0",
    contact={
        "name": "Weblandr",
        "url": "https://weblandr.com",
    },
    license_info={
        "name": "MIT",
        "url": "https://opensource.org/licenses/MIT",
    },
    openapi_tags=[
        {"name": "Email extraction", "description": "Scrape email addresses from websites."},
        {"name": "Operations",       "description": "Health and liveness checks."},
    ],
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-API-Key"],
    max_age=300,
)

MAX_URLS    = 25   # keeps each Lambda invocation within API GW's 29 s hard limit
MAX_WORKERS = 25   # all URLs in a batch run fully concurrently
OVERALL_S   = 22   # wall-clock budget per request (7 s buffer before API GW kills the connection)


# ── Request / response models ─────────────────────────────────────────────────

class EmailRequest(BaseModel):
    urls: list[str] = Field(
        ...,
        min_length=1,
        description="List of website URLs to scrape (1–25 entries, http/https only).",
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
            "examples": [{"urls": ["https://example.com/", "https://acme.co.za/"]}]
        }
    }


class EmailResponse(BaseModel):
    emails: dict[str, list[str]] = Field(
        ...,
        description=(
            "Map of input URL → sorted list of unique email addresses found. "
            "An empty list means no emails were discovered (or the site was unreachable)."
        ),
    )

    model_config = {
        "json_schema_extra": {
            "examples": [{"emails": {"https://example.com/": ["hello@example.com"]}}]
        }
    }


# ── Main endpoint ─────────────────────────────────────────────────────────────

@app.post(
    "/emails",
    response_model=EmailResponse,
    tags=["Email extraction"],
    summary="Extract emails from websites",
    response_description="Email addresses grouped by input URL.",
    responses={
        200: {"description": "Emails extracted successfully (empty lists for unreachable/email-free sites)."},
        422: {"description": "Validation error — empty list, invalid URL, or > 25 URLs."},
    },
)
def get_emails(payload: EmailRequest, request: Request) -> EmailResponse:
    """
    Submit a list of website URLs and receive the email addresses scraped from each.
    All URLs are fetched concurrently. Unreachable or email-free sites return an
    empty list — they do **not** cause the whole request to fail.
    """
    url_strings = [str(u) for u in payload.urls]
    request_id  = str(uuid.uuid4())[:8]
    batch_start = time.monotonic()
    deadline    = batch_start + OVERALL_S

    logger.info(
        "[%s] Extraction started — %d URL(s), budget=%.0fs, workers=%d",
        request_id, len(url_strings), OVERALL_S, min(MAX_WORKERS, len(url_strings)),
    )

    results: dict[str, list[str]] = {}

    with ThreadPoolExecutor(max_workers=min(MAX_WORKERS, len(url_strings))) as pool:
        future_to_url = {pool.submit(extract_emails, url): url for url in url_strings}

        for future in as_completed(future_to_url):
            url       = future_to_url[future]
            remaining = deadline - time.monotonic()

            if remaining <= 0:
                logger.warning("[%s] ⏰ Budget exhausted — skipping %s", request_id, url)
                results[url] = []
                continue

            try:
                emails = future.result(timeout=remaining)
                results[url] = emails
                if emails:
                    logger.info("[%s] ✓ %s → %d email(s): %s", request_id, url, len(emails), emails)
                else:
                    logger.info("[%s] ○ %s → no emails found", request_id, url)
            except FutureTimeoutError:
                logger.warning("[%s] ⏰ Per-URL budget exceeded — %s", request_id, url)
                results[url] = []
            except Exception as exc:
                logger.error("[%s] ✗ Unexpected error for %s: %s", request_id, url, exc, exc_info=True)
                results[url] = []

    # Ensure every requested URL is present in the response (some may not have completed)
    for u in url_strings:
        results.setdefault(u, [])

    elapsed      = time.monotonic() - batch_start
    total_emails = sum(len(v) for v in results.values())
    hit_count    = sum(1 for v in results.values() if v)

    logger.info(
        "[%s] Extraction complete — %d/%d sites had emails, %d unique emails total, %.2fs elapsed",
        request_id, hit_count, len(url_strings), total_emails, elapsed,
    )

    # Persist for campaign / history lookup
    _persist_extraction(request, results, request_id)

    return EmailResponse(emails=results)


# ── Persistence ───────────────────────────────────────────────────────────────

def _persist_extraction(request: Request, emails: dict[str, list[str]], request_id: str = "") -> None:
    try:
        table = _get_table()
        if not table:
            return

        # Pull user identity from Lambda authorizer context (injected by API Gateway)
        aws_event = request.scope.get("aws.event", {})
        user_id   = (
            aws_event.get("requestContext", {})
                     .get("authorizer", {})
                     .get("lambda", {})
                     .get("user_email", "")
        )
        if not user_id:
            logger.debug("[%s] No user_id in authorizer context — skipping persistence", request_id)
            return

        email_count = sum(len(v) for v in emails.values())
        expires     = int((datetime.now(timezone.utc) + timedelta(days=30)).timestamp())
        extraction_id = str(uuid.uuid4())

        table.put_item(Item={
            "extraction_id": extraction_id,
            "user_id":       user_id,
            "urls":          list(emails.keys()),
            "emails":        emails,
            "email_count":   email_count,
            "created_at":    datetime.now(timezone.utc).isoformat(),
            "expires_at":    expires,
        })
        logger.info("[%s] Persisted extraction %s (%d emails) for user %s", request_id, extraction_id, email_count, user_id)
    except Exception as exc:
        logger.warning("[%s] Could not persist extraction: %s", request_id, exc)


# ── Health check ──────────────────────────────────────────────────────────────

@app.get(
    "/health",
    tags=["Operations"],
    summary="Health check",
    response_description="Service liveness status.",
    responses={200: {"content": {"application/json": {"example": {"status": "ok"}}}}},
)
def health() -> dict[str, str]:
    """Returns `{"status": "ok"}` when the service is running."""
    logger.debug("Health check called")
    return {"status": "ok"}


# ── Lambda entrypoint ─────────────────────────────────────────────────────────
handler = Mangum(app, lifespan="off")
