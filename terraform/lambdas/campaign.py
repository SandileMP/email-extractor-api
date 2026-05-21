"""
Campaign Lambda — CRUD + edit + send trigger + extraction list.
Routes:
  POST   /campaigns              create draft
  GET    /campaigns              list user's campaigns
  GET    /campaigns/{id}         get campaign + live stats
  PATCH  /campaigns/{id}         edit draft campaign
  POST   /campaigns/{id}/send    queue recipients for delivery
  GET    /campaigns/{id}/logs    paginated delivery log
  GET    /extractions            list user's email extractions

Recipients are stored as a list of dicts:
  [{"email": "user@example.com", "first_name": "John", "company": "Acme"}, ...]
Plain email strings and CSV / JSON input are all accepted.
Template variables {{first_name}}, {{company}}, etc. are substituted at send time.
"""
import csv
import io
import json
import os
import re
import uuid
from datetime import datetime, timezone, timedelta
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key

# ── Config ────────────────────────────────────────────────────────────────

CAMPAIGNS_TABLE   = os.environ.get("CAMPAIGNS_TABLE",   "meshparse-campaigns")
LOGS_TABLE        = os.environ.get("EMAIL_LOGS_TABLE",  "meshparse-email-logs")
ACCOUNTS_TABLE    = os.environ.get("MAIL_ACCOUNTS_TABLE","meshparse-mail-accounts")
SUPPRESSION_TABLE = os.environ.get("SUPPRESSION_TABLE", "meshparse-suppression")
EXTRACTIONS_TABLE = os.environ.get("EXTRACTIONS_TABLE", "meshparse-extractions")
QUEUE_URL         = os.environ.get("CAMPAIGN_QUEUE_URL","")
REGION            = os.environ.get("AWS_REGION", "eu-west-1")

dynamodb = boto3.resource("dynamodb", region_name=REGION)
sqs      = boto3.client("sqs",      region_name=REGION)
campaigns_t   = dynamodb.Table(CAMPAIGNS_TABLE)
logs_t        = dynamodb.Table(LOGS_TABLE)
accounts_t    = dynamodb.Table(ACCOUNTS_TABLE)
suppression_t = dynamodb.Table(SUPPRESSION_TABLE)
extractions_t = dynamodb.Table(EXTRACTIONS_TABLE)

CORS = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Headers": "Content-Type,X-API-Key",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Content-Type": "application/json",
}

CHUNK_SIZE = 50


# ── Handler ───────────────────────────────────────────────────────────────

def handler(event, context):
    method  = event.get("requestContext", {}).get("http", {}).get("method", "")
    path    = event.get("rawPath", "").rstrip("/")
    user_id = event.get("requestContext", {}).get("authorizer", {}).get("lambda", {}).get("user_email", "anon")
    qs      = event.get("queryStringParameters") or {}

    if method == "OPTIONS":
        return _ok({})

    try:
        if method == "GET" and path.endswith("/extractions"):
            return _list_extractions(user_id, qs)

        if method == "POST" and "/send" in path:
            campaign_id = path.split("/")[-2]
            return _send_campaign(campaign_id, user_id)

        if method == "GET" and "/logs" in path:
            campaign_id = path.split("/")[-2]
            return _campaign_logs(campaign_id, user_id, qs)

        if method == "PATCH" and re.match(r".*/campaigns/[^/]+$", path):
            campaign_id = path.split("/")[-1]
            body = json.loads(event.get("body") or "{}")
            return _edit_campaign(campaign_id, body, user_id)

        if method == "GET" and re.match(r".*/campaigns/[^/]+$", path):
            campaign_id = path.split("/")[-1]
            return _get_campaign(campaign_id, user_id)

        if method == "GET" and path.endswith("/campaigns"):
            return _list_campaigns(user_id, qs)

        if method == "POST" and path.endswith("/campaigns"):
            body = json.loads(event.get("body") or "{}")
            return _create_campaign(body, user_id)

        return _err(404, "Route not found")

    except Exception as e:
        import traceback; traceback.print_exc()
        return _err(500, str(e))


# ── Create campaign ───────────────────────────────────────────────────────

def _create_campaign(body, user_id):
    required = {"name", "mail_account_id", "subject", "html_body"}
    missing  = required - body.keys()
    if missing:
        return _err(400, f"Missing: {', '.join(sorted(missing))}")

    account = accounts_t.get_item(Key={"account_id": body["mail_account_id"]}).get("Item")
    if not account or account.get("user_id") != user_id:
        return _err(404, "Mail account not found")

    recipients = _resolve_recipients(body, user_id)
    if not recipients:
        return _err(400, "No valid recipients provided")

    campaign_id = str(uuid.uuid4())
    now         = datetime.now(timezone.utc).isoformat()
    expires     = int((datetime.now(timezone.utc) + timedelta(days=90)).timestamp())

    item = {
        "campaign_id":      campaign_id,
        "user_id":          user_id,
        "name":             body["name"],
        "mail_account_id":  body["mail_account_id"],
        "from_email":       account["from_email"],
        "from_name":        account.get("from_name", ""),
        "subject":          body["subject"],
        "html_body":        body["html_body"],
        "text_body":        body.get("text_body", ""),
        "recipients":       recipients,
        "recipient_count":  len(recipients),
        "status":           "draft",
        "sent_count":       0,
        "bounced_count":    0,
        "failed_count":     0,
        "created_at":       now,
        "sent_at":          None,
        "expires_at":       expires,
    }
    campaigns_t.put_item(Item=item)
    return _ok(_safe_campaign(item), status=201)


# ── Edit campaign (draft only) ────────────────────────────────────────────

def _edit_campaign(campaign_id, body, user_id):
    item = campaigns_t.get_item(Key={"campaign_id": campaign_id}).get("Item")
    if not item or item.get("user_id") != user_id:
        return _err(404, "Campaign not found")
    if item.get("status") != "draft":
        return _err(409, "Only draft campaigns can be edited")

    updates = {}
    expr_names  = {}
    expr_values = {}

    editable = {"name", "subject", "html_body", "text_body", "mail_account_id"}
    for field in editable:
        if field in body:
            if field == "mail_account_id":
                account = accounts_t.get_item(Key={"account_id": body["mail_account_id"]}).get("Item")
                if not account or account.get("user_id") != user_id:
                    return _err(404, "Mail account not found")
                updates["mail_account_id"] = body["mail_account_id"]
                updates["from_email"]      = account["from_email"]
                updates["from_name"]       = account.get("from_name", "")
            else:
                updates[field] = body[field]

    # Re-resolve recipients if any recipient fields are present
    recipient_keys = {"recipients", "extraction_id", "recipients_csv", "recipients_json"}
    if recipient_keys & body.keys():
        recipients = _resolve_recipients(body, user_id)
        if not recipients:
            return _err(400, "No valid recipients provided")
        updates["recipients"]      = recipients
        updates["recipient_count"] = len(recipients)

    if not updates:
        return _err(400, "Nothing to update")

    set_parts = []
    for i, (k, v) in enumerate(updates.items()):
        name_key  = f"#f{i}"
        value_key = f":v{i}"
        expr_names[name_key]  = k
        expr_values[value_key] = v
        set_parts.append(f"{name_key} = {value_key}")

    campaigns_t.update_item(
        Key={"campaign_id": campaign_id},
        UpdateExpression="SET " + ", ".join(set_parts),
        ExpressionAttributeNames=expr_names,
        ExpressionAttributeValues=expr_values,
    )

    updated = campaigns_t.get_item(Key={"campaign_id": campaign_id}).get("Item", {})
    return _ok(_safe_campaign(_from_dynamo(updated)))


# ── Resolve recipients ────────────────────────────────────────────────────

def _resolve_recipients(body, user_id):
    """
    Returns a deduplicated list of recipient dicts:
      [{"email": "...", "first_name": "...", ...}, ...]

    Accepts:
    - recipients: list of strings OR list of dicts (with at least "email")
    - recipients_csv: CSV string with a header row containing "email" column
    - recipients_json: JSON string of the list of dicts
    - extraction_id: pull emails from a prior extraction (email-only, no extra vars)
    """
    seen   = {}   # email → dict

    def _add(record):
        if isinstance(record, str):
            record = {"email": record.strip().lower()}
        email = str(record.get("email", "")).strip().lower()
        if _valid_email(email):
            merged = {k: v for k, v in record.items() if k != "email"}
            merged["email"] = email
            seen[email] = merged

    # Plain list / dict list
    for r in body.get("recipients", []):
        _add(r)

    # CSV string
    csv_raw = body.get("recipients_csv", "")
    if csv_raw:
        reader = csv.DictReader(io.StringIO(csv_raw.strip()))
        if reader.fieldnames and "email" in [f.lower().strip() for f in reader.fieldnames]:
            # normalise header names
            reader.fieldnames = [f.strip().lower() for f in reader.fieldnames]
            for row in reader:
                _add({k: v.strip() for k, v in row.items()})

    # JSON string
    json_raw = body.get("recipients_json", "")
    if json_raw:
        try:
            for r in json.loads(json_raw):
                _add(r)
        except (json.JSONDecodeError, TypeError):
            pass

    # From a previous extraction (email-only)
    extraction_id = body.get("extraction_id")
    if extraction_id:
        ext = extractions_t.get_item(Key={"extraction_id": extraction_id}).get("Item")
        if ext and ext.get("user_id") == user_id:
            for url_emails in ext.get("emails", {}).values():
                for e in url_emails:
                    _add(e)

    return sorted(seen.values(), key=lambda r: r["email"])


# ── List campaigns ────────────────────────────────────────────────────────

def _list_campaigns(user_id, qs):
    limit = min(int(qs.get("limit", 20)), 100)
    resp  = campaigns_t.query(
        IndexName="user_id-index",
        KeyConditionExpression=Key("user_id").eq(user_id),
        ScanIndexForward=False,
        Limit=limit,
        ProjectionExpression="campaign_id,#n,#s,recipient_count,sent_count,bounced_count,failed_count,created_at,sent_at",
        ExpressionAttributeNames={"#n": "name", "#s": "status"},
    )
    return _ok({"campaigns": [_from_dynamo(i) for i in resp.get("Items", [])]})


# ── Get single campaign ───────────────────────────────────────────────────

def _get_campaign(campaign_id, user_id):
    item = campaigns_t.get_item(Key={"campaign_id": campaign_id}).get("Item")
    if not item or item.get("user_id") != user_id:
        return _err(404, "Campaign not found")
    return _ok(_safe_campaign(_from_dynamo(item)))


# ── Send campaign ─────────────────────────────────────────────────────────

def _send_campaign(campaign_id, user_id):
    item = campaigns_t.get_item(Key={"campaign_id": campaign_id}).get("Item")
    if not item or item.get("user_id") != user_id:
        return _err(404, "Campaign not found")
    if item.get("status") not in ("draft", "failed"):
        return _err(409, f"Campaign is already {item['status']}")

    recipients = item.get("recipients", [])
    if not recipients:
        return _err(400, "No recipients")

    # Normalise legacy string recipients to dicts
    recipients = [r if isinstance(r, dict) else {"email": r} for r in recipients]

    # Remove suppressed emails
    active  = [r for r in recipients if not _is_suppressed(r["email"])]
    skipped = len(recipients) - len(active)

    for i in range(0, len(active), CHUNK_SIZE):
        chunk = active[i:i + CHUNK_SIZE]
        sqs.send_message(
            QueueUrl=QUEUE_URL,
            MessageBody=json.dumps({
                "campaign_id":     campaign_id,
                "mail_account_id": item["mail_account_id"],
                "user_id":         user_id,
                "recipients":      chunk,
            }),
        )

    now = datetime.now(timezone.utc).isoformat()
    campaigns_t.update_item(
        Key={"campaign_id": campaign_id},
        UpdateExpression="SET #s = :s, sent_at = :t",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={":s": "queued", ":t": now},
    )

    return _ok({
        "campaign_id": campaign_id,
        "queued":      len(active),
        "skipped":     skipped,
        "status":      "queued",
    })


# ── Campaign logs ─────────────────────────────────────────────────────────

def _campaign_logs(campaign_id, user_id, qs):
    item = campaigns_t.get_item(Key={"campaign_id": campaign_id}).get("Item")
    if not item or item.get("user_id") != user_id:
        return _err(404, "Campaign not found")

    limit = min(int(qs.get("limit", 50)), 200)
    resp  = logs_t.query(
        IndexName="campaign_id-index",
        KeyConditionExpression=Key("campaign_id").eq(campaign_id),
        ScanIndexForward=False,
        Limit=limit,
    )
    return _ok({"logs": [_from_dynamo(i) for i in resp.get("Items", [])]})


# ── Extractions list ──────────────────────────────────────────────────────

def _list_extractions(user_id, qs):
    limit = min(int(qs.get("limit", 20)), 100)
    resp  = extractions_t.query(
        IndexName="user_id-index",
        KeyConditionExpression=Key("user_id").eq(user_id),
        ScanIndexForward=False,
        Limit=limit,
        ProjectionExpression="extraction_id,#u,email_count,created_at",
        ExpressionAttributeNames={"#u": "urls"},
    )
    return _ok({"extractions": [_from_dynamo(i) for i in resp.get("Items", [])]})


# ── Helpers ───────────────────────────────────────────────────────────────

def _is_suppressed(email):
    return bool(suppression_t.get_item(Key={"email": email.lower()}).get("Item"))


def _valid_email(email):
    return bool(re.match(r"^[^@]+@[^@]+\.[^@]+$", str(email)))


def _safe_campaign(item):
    """Drop the full recipients list from API responses (can be thousands of rows)."""
    return {k: v for k, v in item.items() if k != "recipients"}


def _from_dynamo(obj):
    if isinstance(obj, dict):    return {k: _from_dynamo(v) for k, v in obj.items()}
    if isinstance(obj, list):    return [_from_dynamo(v) for v in obj]
    if isinstance(obj, Decimal): return int(obj) if obj == obj.to_integral_value() else float(obj)
    return obj


def _ok(data, status=200):
    return {"statusCode": status, "headers": CORS, "body": json.dumps(data, default=str)}


def _err(code, msg):
    return {"statusCode": code, "headers": CORS, "body": json.dumps({"error": msg})}
