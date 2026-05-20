import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urlparse

from fastapi import FastAPI
from mangum import Mangum
from pydantic import BaseModel, field_validator

from scraper import extract_emails

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Email Extractor API",
    description="Extract email addresses from a list of website URLs.",
    version="1.0.0",
)

MAX_URLS = 50
MAX_WORKERS = 10


class EmailRequest(BaseModel):
    # Use plain str so the original URL is preserved as the response key.
    urls: list[str]

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


class EmailResponse(BaseModel):
    emails: dict[str, list[str]]


@app.post("/emails", response_model=EmailResponse)
def get_emails(payload: EmailRequest) -> EmailResponse:
    """
    POST /emails

    Body: {"urls": ["https://example.com", ...]}
    Returns a mapping of each URL to the email addresses found on that site.
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


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


# Lambda entrypoint
handler = Mangum(app, lifespan="off")
