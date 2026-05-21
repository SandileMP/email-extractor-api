"""
Campaign Lambda — CRUD + send trigger + extraction list.
Routes:
  POST /campaigns              create draft
  GET  /campaigns              list user's campaigns
  GET  /campaigns/{id}         get campaign + live stats
  POST /campaigns/{id}/send    queue recipients for delivery
  GET  /campaigns/{id}/logs    paginated delivery log
  GET  /extractions            list user's email extractions
"""
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
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Content-Type": "application/json",
}

CHUNK_SIZE = 50   # recipients per SQS message


# ── Handler ───────────────────────────────────────────────────────────────

def handler(event, context):
    method  = event.get("requestContext", {}).get("http", {}).get("method", "")
    path    = event.get("rawPath", "").rstrip("/")
    user_id = event.get("requestContext", {}).get("authorizer", {}).get("lambda", {}).get("user_email", "anon")
    qs      = event.get("queryStringParameters") or {}

    if method == "OPTIONS":
        return _ok({})

    try:
        # Extractions list
        if method == "GET" and path.endswith("/extractions"):
            return _list_extractions(user_id, qs)

        # Campaign send
        if method == "POST" and "/send" in path:
            campaign_id = path.split("/")[-2]
            return _send_campaign(campaign_id, user_id)

        # Campaign logs
        if method == "GET" and "/logs" in path:
            campaign_id = path.split("/")[-2]
            return _campaign_logs(campaign_id, user_id, qs)

        # Single campaign
        if method == "GET" and re.match(r".*/campaigns/[^/]+$", path):
            campaign_id = path.split("/")[-1]
            return _get_campaign(campaign_id, user_id)

        # Campaign list
        if method == "GET" and path.endswith("/campaigns"):
            return _list_campaigns(user_id, qs)

        # Create campaign
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

    # Verify account belongs to user
    account = accounts_t.get_item(Key={"account_id": body["mail_account_id"]}).get("Item")
    if not account or account.get("user_id") != user_id:
        return _err(404, "Mail account not found")

    # Build recipient list
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


def _resolve_recipients(body, user_id):
    emails = set()

    # Manual list
    for e in body.get("recipients", []):
        if _valid_email(e):
            emails.add(e.lower().strip())

    # From a previous extraction
    extraction_id = body.get("extraction_id")
    if extraction_id:
        ext = extractions_t.get_item(Key={"extraction_id": extraction_id}).get("Item")
        if ext and ext.get("user_id") == user_id:
            for url_emails in ext.get("emails", {}).values():
                for e in url_emails:
                    if _valid_email(e):
                        emails.add(e.lower().strip())

    return sorted(emails)


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

    # Remove suppressed emails
    active = [r for r in recipients if not _is_suppressed(r)]
    skipped = len(recipients) - len(active)

    # Push chunks to SQS
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
    # Verify ownership
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
    resp = suppression_t.get_item(Key={"email": email.lower()})
    return bool(resp.get("Item"))


def _valid_email(email):
    return bool(re.match(r"^[^@]+@[^@]+\.[^@]+$", str(email)))


def _safe_campaign(item):
    """Drop the full recipients list from API responses (can be thousands of emails)."""
    return {k: v for k, v in item.items() if k != "recipients"}


def _from_dynamo(obj):
    if isinstance(obj, dict):  return {k: _from_dynamo(v) for k, v in obj.items()}
    if isinstance(obj, list):  return [_from_dynamo(v) for v in obj]
    if isinstance(obj, Decimal): return int(obj) if obj == obj.to_integral_value() else float(obj)
    return obj


def _ok(data, status=200):
    return {"statusCode": status, "headers": CORS, "body": json.dumps(data, default=str)}


def _err(code, msg):
    return {"statusCode": code, "headers": CORS, "body": json.dumps({"error": msg})}
