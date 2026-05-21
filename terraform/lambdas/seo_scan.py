"""
MeshParse SEO Scan Lambda
Routes:
  POST /seo/scan              — run a scan (sync, with optional deep audit)
  GET  /seo/scan/{scanId}     — retrieve scan by ID
  GET  /seo/scans             — list user's recent scans
"""

import hashlib
import json
import os
import re
import time
import urllib.parse
import uuid
from datetime import datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal

import boto3
import requests
from boto3.dynamodb.conditions import Key
from bs4 import BeautifulSoup

# ── Config ────────────────────────────────────────────────────────────────

TABLE       = os.environ.get("SEO_SCANS_TABLE", "meshparse-seo-scans")
REGION      = os.environ.get("AWS_REGION", "eu-west-1")
CACHE_HOURS = 6
MAX_PAGES   = 10      # hard ceiling for deep audits
PAGE_TIMEOUT = 12     # seconds per page fetch

dynamodb = boto3.resource("dynamodb", region_name=REGION)
table    = dynamodb.Table(TABLE)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
}

CORS = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Headers": "Content-Type,X-API-Key",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Content-Type": "application/json",
}


# ── Handler / router ──────────────────────────────────────────────────────

def handler(event, context):
    method = event.get("requestContext", {}).get("http", {}).get("method", "")
    path   = event.get("rawPath", "")

    if method == "OPTIONS":
        return _ok({})

    user_id = (
        event.get("requestContext", {})
             .get("authorizer", {})
             .get("lambda", {})
             .get("user_email", "anonymous")
    )

    try:
        if method == "POST" and path.rstrip("/") == "/seo/scan":
            return _handle_scan(event, user_id)

        if method == "GET" and re.match(r"^/seo/scan/[^/]+$", path):
            scan_id = path.split("/")[-1]
            return _handle_get(scan_id, user_id)

        if method == "GET" and path.rstrip("/") == "/seo/scans":
            return _handle_list(event, user_id)

        return _err(404, "Route not found")

    except Exception as exc:
        print(f"Unhandled error: {exc}")
        import traceback; traceback.print_exc()
        return _err(500, "Internal server error")


# ── Route handlers ────────────────────────────────────────────────────────

def _handle_scan(event, user_id):
    try:
        body = json.loads(event.get("body") or "{}")
    except Exception:
        return _err(400, "Invalid JSON body")

    raw_url   = body.get("url", "").strip()
    force     = bool(body.get("force", False))
    depth     = max(1, int(body.get("depth", 1)))
    max_pages = min(int(body.get("max_pages", 1 if depth == 1 else 5)), MAX_PAGES)

    if not raw_url:
        return _err(400, "url is required")

    url = _normalise_url(raw_url)
    if not url:
        return _err(400, f"Invalid URL: {raw_url!r}")

    url_hash = hashlib.sha256(url.encode()).hexdigest()

    # Cache lookup (unless force=True)
    if not force:
        cached = _get_cache(user_id, url_hash)
        if cached:
            cached["cached"] = True
            return _ok(cached)

    # Run the scan
    scan = _run_scan(url, url_hash, user_id, depth, max_pages)
    _save_scan(scan)
    return _ok(scan)


def _handle_get(scan_id, user_id):
    resp = table.get_item(Key={"scan_id": scan_id})
    item = resp.get("Item")
    if not item or item.get("user_id") != user_id:
        return _err(404, "Scan not found")
    return _ok(_from_dynamo(item))


def _handle_list(event, user_id):
    qs    = event.get("queryStringParameters") or {}
    limit = min(int(qs.get("limit", 20)), 100)

    resp = table.query(
        IndexName="user_id-index",
        KeyConditionExpression=Key("user_id").eq(user_id),
        ScanIndexForward=False,
        Limit=limit,
        ProjectionExpression=(
            "scan_id, #u, score, #s, created_at, pages_scanned, #d"
        ),
        ExpressionAttributeNames={"#u": "url", "#s": "status", "#d": "depth"},
    )
    return _ok({"scans": [_from_dynamo(i) for i in resp.get("Items", [])]})


# ── Core scan orchestration ───────────────────────────────────────────────

def _run_scan(url, url_hash, user_id, depth, max_pages):
    scan_id    = str(uuid.uuid4())
    started_at = datetime.now(timezone.utc)
    pages      = []

    # Always scan the root URL first
    root = _scan_page(url, base_url=url)
    pages.append(root)

    # Deep audit: discover and scan internal links
    if depth > 1 and max_pages > 1 and root.get("status") == "ok":
        discovered = _discover_links(root["_soup"], url)
        seen       = {url}
        for link in discovered:
            if len(pages) >= max_pages:
                break
            if link in seen:
                continue
            seen.add(link)
            try:
                time.sleep(0.3)   # polite crawl delay
                pages.append(_scan_page(link, base_url=url))
            except Exception as e:
                print(f"Skip {link}: {e}")

    # Strip internal soup object before storing
    for p in pages:
        p.pop("_soup", None)

    aggregate = _aggregate(pages)

    return {
        "scan_id":      scan_id,
        "url":          url,
        "url_hash":     url_hash,
        "user_id":      user_id,
        "status":       "complete",
        "score":        aggregate["score"],
        "depth":        depth,
        "pages_scanned": len(pages),
        "created_at":   started_at.isoformat(),
        "cached":       False,
        "results":      aggregate,
        "pages":        pages if len(pages) > 1 else None,
    }


def _aggregate(pages):
    """Merge per-page results into a single aggregate report."""
    if not pages:
        return {}
    if len(pages) == 1:
        return pages[0].get("results", {})

    # Score = simple average across all successfully scanned pages
    scores  = [p["score"] for p in pages if p.get("status") == "ok"]
    avg_score = int(sum(scores) / len(scores)) if scores else 0

    # Aggregate issues (deduplicate by code)
    seen_codes = set()
    all_issues = []
    for p in pages:
        for issue in p.get("results", {}).get("issues", []):
            key = f"{issue['code']}:{issue.get('page','')}"
            if key not in seen_codes:
                seen_codes.add(key)
                all_issues.append(issue)

    all_issues.sort(key=lambda x: {"critical": 0, "high": 1, "medium": 2, "low": 3}.get(x["severity"], 4))

    # Use root page results as the base, then override score + issues
    base = dict(pages[0].get("results", {}))
    base["score"]  = avg_score
    base["issues"] = all_issues
    base["pages_summary"] = [
        {"url": p["url"], "score": p.get("score", 0), "status": p.get("status")}
        for p in pages
    ]
    return base


# ── Page scanner ──────────────────────────────────────────────────────────

def _scan_page(url, base_url):
    """Fetch and analyse one page. Returns page dict."""
    t0 = time.time()
    try:
        resp = requests.get(url, headers=HEADERS, timeout=PAGE_TIMEOUT,
                            allow_redirects=True)
        elapsed_ms = int((time.time() - t0) * 1000)
        soup       = BeautifulSoup(resp.content, "lxml")

        results = {
            "meta":      _check_meta(soup),
            "headings":  _check_headings(soup),
            "links":     _check_links(soup, base_url),
            "images":    _check_images(soup),
            "open_graph": _check_og(soup),
            "technical": _check_technical(url, resp, elapsed_ms, base_url),
            "content":   _check_content(soup),
        }
        results["issues"] = _build_issues(results, url)
        results["score"]  = _calculate_score(results)

        return {"url": url, "status": "ok", "score": results["score"],
                "results": results, "_soup": soup}

    except requests.exceptions.Timeout:
        return {"url": url, "status": "timeout", "score": 0,
                "results": {}, "error": "Page did not respond within timeout"}
    except Exception as e:
        return {"url": url, "status": "error", "score": 0,
                "results": {}, "error": str(e)}


# ── SEO checks ────────────────────────────────────────────────────────────

def _check_meta(soup):
    def _m(name):
        tag = soup.find("meta", attrs={"name": name})
        return tag.get("content", "").strip() if tag else ""

    def _mp(prop):
        tag = soup.find("meta", attrs={"property": prop})
        return tag.get("content", "").strip() if tag else ""

    title_tag  = soup.find("title")
    title      = title_tag.get_text(strip=True) if title_tag else ""
    desc       = _m("description") or _m("Description")
    canonical  = ""
    can_tag    = soup.find("link", rel=lambda r: r and "canonical" in r)
    if can_tag:
        canonical = can_tag.get("href", "").strip()

    vp_tag    = soup.find("meta", attrs={"name": re.compile("viewport", re.I)})
    viewport  = vp_tag.get("content", "").strip() if vp_tag else ""

    robots_tag = soup.find("meta", attrs={"name": re.compile("robots", re.I)})
    robots     = robots_tag.get("content", "").strip() if robots_tag else ""

    return {
        "title":               title,
        "title_length":        len(title),
        "title_optimal":       50 <= len(title) <= 60,
        "description":         desc,
        "description_length":  len(desc),
        "description_optimal": 140 <= len(desc) <= 160,
        "keywords":            _m("keywords"),
        "robots":              robots,
        "canonical":           canonical,
        "viewport":            viewport,
        "has_viewport":        bool(viewport),
    }


def _check_headings(soup):
    h1s = [h.get_text(strip=True) for h in soup.find_all("h1")]
    return {
        "h1_count": len(h1s),
        "h1_texts": h1s[:5],
        "h2_count": len(soup.find_all("h2")),
        "h3_count": len(soup.find_all("h3")),
        "h4_count": len(soup.find_all("h4")),
    }


def _check_links(soup, base_url):
    parsed_base = urllib.parse.urlparse(base_url)
    internal = external = nofollow = 0
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if not href or href.startswith(("#", "javascript:", "mailto:", "tel:")):
            continue
        full = urllib.parse.urljoin(base_url, href)
        p    = urllib.parse.urlparse(full)
        if p.netloc == parsed_base.netloc:
            internal += 1
        elif p.scheme in ("http", "https"):
            external += 1
        rel = a.get("rel", [])
        if "nofollow" in (rel if isinstance(rel, list) else [rel]):
            nofollow += 1
    return {"internal_count": internal, "external_count": external,
            "nofollow_count": nofollow}


def _check_images(soup):
    imgs     = soup.find_all("img")
    no_alt   = sum(1 for i in imgs if not i.get("alt", "").strip())
    total    = len(imgs)
    coverage = round(((total - no_alt) / total * 100) if total else 100, 1)
    return {"total": total, "missing_alt": no_alt,
            "alt_coverage": coverage}


def _check_og(soup):
    def _og(prop):
        t = soup.find("meta", attrs={"property": f"og:{prop}"})
        return t.get("content", "").strip() if t else ""

    return {
        "has_og_title":       bool(_og("title")),
        "has_og_description": bool(_og("description")),
        "has_og_image":       bool(_og("image")),
        "has_og_url":         bool(_og("url")),
        "og_title":           _og("title"),
        "og_description":     _og("description")[:200],
        "og_image":           _og("image"),
    }


def _check_technical(url, resp, elapsed_ms, base_url):
    parsed      = urllib.parse.urlparse(url)
    base_parsed = urllib.parse.urlparse(base_url)
    base        = f"{base_parsed.scheme}://{base_parsed.netloc}"

    # Check robots.txt and sitemap
    robots_ok  = _head_ok(f"{base}/robots.txt")
    sitemap_ok = _head_ok(f"{base}/sitemap.xml") or _head_ok(f"{base}/sitemap_index.xml")

    # Schema markup detection
    text = resp.text if hasattr(resp, "text") else ""
    has_schema = (
        bool(re.search(r'"@type"\s*:', text)) or
        bool(re.search(r'itemtype\s*=\s*["\']https?://schema\.org', text))
    )

    return {
        "status_code":     resp.status_code,
        "response_time_ms": elapsed_ms,
        "page_size_bytes": len(resp.content),
        "is_https":        parsed.scheme == "https",
        "has_robots_txt":  robots_ok,
        "has_sitemap":     sitemap_ok,
        "has_schema_markup": has_schema,
        "final_url":       resp.url,
        "redirected":      resp.url != url,
    }


def _check_content(soup):
    for tag in soup(["script", "style", "noscript", "header", "footer", "nav"]):
        tag.decompose()
    text       = soup.get_text(separator=" ")
    words      = [w for w in re.split(r"\s+", text) if w]
    html_len   = len(str(soup))
    text_len   = len(text)
    ratio      = round(text_len / html_len * 100, 1) if html_len else 0
    return {"word_count": len(words), "text_html_ratio": ratio}


# ── Scoring ───────────────────────────────────────────────────────────────

def _calculate_score(r):
    s = 0
    m = r.get("meta", {})

    # Title (0–15)
    if m.get("title"):
        s += 8
        if m.get("title_optimal"):
            s += 7
        elif 40 <= m.get("title_length", 0) <= 70:
            s += 3

    # Description (0–15)
    if m.get("description"):
        s += 8
        if m.get("description_optimal"):
            s += 7
        elif 100 <= m.get("description_length", 0) <= 200:
            s += 3

    # H1 (0–10)
    h1 = r.get("headings", {}).get("h1_count", 0)
    if h1 == 1:
        s += 10
    elif h1 > 1:
        s += 3

    # HTTPS (0–10)
    if r.get("technical", {}).get("is_https"):
        s += 10

    # Images alt (0–10)
    img = r.get("images", {})
    total = img.get("total", 0)
    if total == 0:
        s += 10
    else:
        s += int(img.get("alt_coverage", 0) / 10)

    # Canonical (0–5)
    if m.get("canonical"):
        s += 5

    # Open Graph (0–10)
    og = r.get("open_graph", {})
    og_pts = sum([
        og.get("has_og_title", False),
        og.get("has_og_description", False),
        og.get("has_og_image", False),
        og.get("has_og_url", False),
    ])
    s += int(og_pts / 4 * 10)

    # Schema markup (0–5)
    if r.get("technical", {}).get("has_schema_markup"):
        s += 5

    # robots.txt (0–5)
    if r.get("technical", {}).get("has_robots_txt"):
        s += 5

    # Sitemap (0–5)
    if r.get("technical", {}).get("has_sitemap"):
        s += 5

    # Response time (0–10)
    rt = r.get("technical", {}).get("response_time_ms", 9999)
    if rt < 800:
        s += 10
    elif rt < 1500:
        s += 7
    elif rt < 2500:
        s += 4
    elif rt < 4000:
        s += 2

    return min(s, 100)


# ── Issues ────────────────────────────────────────────────────────────────

def _build_issues(r, url):
    issues = []

    def add(severity, code, message, fix=None):
        i = {"severity": severity, "code": code, "message": message}
        if fix:
            i["fix"] = fix
        issues.append(i)

    m  = r.get("meta", {})
    h  = r.get("headings", {})
    im = r.get("images", {})
    og = r.get("open_graph", {})
    t  = r.get("technical", {})
    c  = r.get("content", {})

    # Critical
    if not t.get("is_https"):
        add("critical", "not_https", "Site is not served over HTTPS",
            "Obtain an SSL certificate and redirect HTTP to HTTPS")

    if t.get("status_code", 200) >= 400:
        add("critical", "bad_status_code",
            f"Page returned HTTP {t.get('status_code')} — not indexable")

    # High
    if not m.get("title"):
        add("high", "missing_title", "Page has no <title> tag",
            "Add a descriptive title between 50–60 characters")
    elif not m.get("title_optimal"):
        tl = m.get("title_length", 0)
        if tl < 50:
            add("high", "title_too_short",
                f"Title is {tl} chars — aim for 50–60",
                "Expand the title to include primary keyword and brand")
        else:
            add("high", "title_too_long",
                f"Title is {tl} chars — likely truncated in SERPs",
                "Shorten to under 60 characters")

    if h.get("h1_count", 0) == 0:
        add("high", "missing_h1", "Page has no H1 heading",
            "Add exactly one H1 containing the primary keyword")
    elif h.get("h1_count", 0) > 1:
        add("high", "multiple_h1",
            f"Page has {h['h1_count']} H1 tags — should have exactly 1",
            "Keep only the most important H1, demote others to H2")

    if not m.get("description"):
        add("high", "missing_description", "Page has no meta description",
            "Write a compelling 140–160 character meta description")

    # Medium
    if m.get("description") and not m.get("description_optimal"):
        dl = m.get("description_length", 0)
        if dl < 140:
            add("medium", "description_too_short",
                f"Meta description is {dl} chars — aim for 140–160")
        else:
            add("medium", "description_too_long",
                f"Meta description is {dl} chars — may be truncated in SERPs")

    missing_alt = im.get("missing_alt", 0)
    if missing_alt > 0:
        add("medium", "images_missing_alt",
            f"{missing_alt} of {im.get('total',0)} images have no alt text",
            "Add descriptive alt attributes to all meaningful images")

    if not m.get("canonical"):
        add("medium", "missing_canonical",
            "No canonical URL specified — risk of duplicate content",
            "Add <link rel='canonical' href='...'> to the <head>")

    if t.get("response_time_ms", 0) > 3000:
        add("medium", "slow_response",
            f"Page took {t['response_time_ms']}ms — aim for under 1500ms",
            "Optimise server response time, enable caching, use a CDN")

    # Low
    if not og.get("has_og_title") or not og.get("has_og_image"):
        missing = [k.replace("has_og_", "og:") for k, v in og.items()
                   if k.startswith("has_og_") and not v]
        if missing:
            add("low", "incomplete_open_graph",
                f"Missing Open Graph tags: {', '.join(missing)}",
                "Add OG meta tags to control social media preview appearance")

    if not t.get("has_schema_markup"):
        add("low", "no_schema_markup", "No structured data (JSON-LD) found",
            "Add Schema.org markup to enhance search result appearance")

    if not t.get("has_robots_txt"):
        add("low", "no_robots_txt", "robots.txt not found or inaccessible",
            "Create /robots.txt to guide search engine crawlers")

    if not t.get("has_sitemap"):
        add("low", "no_sitemap", "sitemap.xml not found",
            "Create and submit an XML sitemap via Google Search Console")

    if not m.get("has_viewport"):
        add("low", "no_viewport",
            "No viewport meta tag — may not be mobile-friendly",
            "Add <meta name='viewport' content='width=device-width, initial-scale=1'>")

    if c.get("word_count", 0) < 300:
        add("low", "thin_content",
            f"Page has only {c.get('word_count',0)} words — thin content",
            "Expand content to at least 300 words for better relevance signals")

    issues.sort(key=lambda x: {"critical": 0, "high": 1, "medium": 2, "low": 3}
                .get(x["severity"], 4))
    return issues


# ── Internal link discovery ───────────────────────────────────────────────

def _discover_links(soup, base_url):
    if not soup:
        return []
    parsed_base = urllib.parse.urlparse(base_url)
    seen  = {_normalise_url(base_url)}
    links = []
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if not href or href.startswith(("#", "mailto:", "tel:", "javascript:")):
            continue
        full   = urllib.parse.urljoin(base_url, href)
        parsed = urllib.parse.urlparse(full)
        if parsed.netloc != parsed_base.netloc:
            continue
        if parsed.scheme not in ("http", "https"):
            continue
        # Skip common non-content paths
        skip = re.compile(r"\.(jpg|jpeg|png|gif|svg|pdf|zip|css|js|woff|ico)$", re.I)
        if skip.search(parsed.path):
            continue
        norm = _normalise_url(full)
        if norm and norm not in seen:
            seen.add(norm)
            links.append(norm)
    return links


# ── Cache + DynamoDB ──────────────────────────────────────────────────────

def _get_cache(user_id, url_hash):
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=CACHE_HOURS)).isoformat()
    resp = table.query(
        IndexName="user_id-index",
        KeyConditionExpression=(
            Key("user_id").eq(user_id) & Key("created_at").gt(cutoff)
        ),
        FilterExpression=boto3.dynamodb.conditions.Attr("url_hash").eq(url_hash),
        Limit=1,
        ScanIndexForward=False,
    )
    items = resp.get("Items", [])
    return _from_dynamo(items[0]) if items else None


def _save_scan(scan):
    now    = datetime.now(timezone.utc)
    expiry = int((now + timedelta(days=30)).timestamp())
    item   = _to_dynamo({**scan, "expires_at": expiry})
    table.put_item(Item=item)


# ── DynamoDB serialisation ────────────────────────────────────────────────

def _to_dynamo(obj):
    """Recursively convert floats to Decimal for DynamoDB."""
    if isinstance(obj, dict):
        return {k: _to_dynamo(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_to_dynamo(v) for v in obj]
    if isinstance(obj, float):
        return Decimal(str(obj))
    return obj


def _from_dynamo(obj):
    """Recursively convert Decimal back to float/int."""
    if isinstance(obj, dict):
        return {k: _from_dynamo(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_from_dynamo(v) for v in obj]
    if isinstance(obj, Decimal):
        return int(obj) if obj == obj.to_integral_value() else float(obj)
    return obj


# ── Utilities ─────────────────────────────────────────────────────────────

def _normalise_url(url):
    try:
        p = urllib.parse.urlparse(url)
        if p.scheme not in ("http", "https") or not p.netloc:
            return None
        # Remove fragment, keep query
        return urllib.parse.urlunparse((p.scheme, p.netloc, p.path or "/",
                                        p.params, p.query, ""))
    except Exception:
        return None


def _head_ok(url):
    try:
        r = requests.head(url, headers=HEADERS, timeout=5, allow_redirects=True)
        if r.status_code == 405:  # HEAD not allowed, try GET
            r = requests.get(url, headers=HEADERS, timeout=5, stream=True)
        return r.status_code < 400
    except Exception:
        return False


def _ok(data):
    return {"statusCode": 200, "headers": CORS, "body": json.dumps(data)}


def _err(code, msg):
    return {"statusCode": code, "headers": CORS, "body": json.dumps({"error": msg})}
