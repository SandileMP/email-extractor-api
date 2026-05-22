"""
Admin Lambda — super_admin only.
All routes verify role=super_admin via Supabase app_metadata before executing.

GET  /admin/overview          platform totals + MRR
GET  /admin/users             paginated user list
GET  /admin/users/{id}        full user detail + usage
PATCH /admin/users/{id}/key   revoke or restore API key
PATCH /admin/users/{id}/subscription  override subscription status
DELETE /admin/users/{id}      delete user + cascade
GET  /admin/revenue           Paystack MRR + subscriber list
GET  /admin/campaigns         all campaigns across all users
GET  /admin/usage             per-user consumption ranked table
"""
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Attr

# ── Config ────────────────────────────────────────────────────────────────

REGION               = os.environ.get("AWS_REGION", "eu-west-1")
SUPABASE_URL         = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
PAYSTACK_SECRET      = os.environ.get("PAYSTACK_SECRET_KEY", "")

CAMPAIGNS_TABLE   = os.environ.get("CAMPAIGNS_TABLE",    "meshparse-campaigns")
LOGS_TABLE        = os.environ.get("EMAIL_LOGS_TABLE",   "meshparse-email-logs")
EXTRACTIONS_TABLE = os.environ.get("EXTRACTIONS_TABLE",  "meshparse-extractions")
SEO_TABLE         = os.environ.get("SEO_SCANS_TABLE",    "meshparse-seo-scans")
API_KEYS_TABLE    = os.environ.get("API_KEYS_TABLE",     "meshparse-api-keys")

dynamodb     = boto3.resource("dynamodb", region_name=REGION)
campaigns_t  = dynamodb.Table(CAMPAIGNS_TABLE)
logs_t       = dynamodb.Table(LOGS_TABLE)
extractions_t= dynamodb.Table(EXTRACTIONS_TABLE)
seo_t        = dynamodb.Table(SEO_TABLE)
api_keys_t   = dynamodb.Table(API_KEYS_TABLE)

CORS = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Headers": "Content-Type,X-API-Key",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Content-Type": "application/json",
}


# ── Handler ───────────────────────────────────────────────────────────────

def handler(event, context):
    method   = event.get("requestContext", {}).get("http", {}).get("method", "")
    path     = event.get("rawPath", "").rstrip("/")
    qs       = event.get("queryStringParameters") or {}
    caller   = event.get("requestContext", {}).get("authorizer", {}).get("lambda", {}).get("user_email", "")

    if method == "OPTIONS":
        return _ok({})

    # Verify caller is super_admin
    if not _is_admin(caller):
        return _err(403, "Forbidden — super_admin role required")

    try:
        body = json.loads(event.get("body") or "{}")

        # ── Overview ───────────────────────────────────────────────────
        if method == "GET" and path.endswith("/admin/overview"):
            return _overview()

        # ── Users list ─────────────────────────────────────────────────
        if method == "GET" and re.match(r".*/admin/users$", path):
            return _list_users(qs)

        # ── User detail ────────────────────────────────────────────────
        if method == "GET" and re.match(r".*/admin/users/[^/]+$", path):
            user_id = path.split("/")[-1]
            return _get_user(user_id)

        # ── Revoke / restore API key ───────────────────────────────────
        if method == "PATCH" and "/key" in path:
            user_id = path.split("/")[-2]
            return _patch_key(user_id, body)

        # ── Override subscription ──────────────────────────────────────
        if method == "PATCH" and "/subscription" in path:
            user_id = path.split("/")[-2]
            return _patch_subscription(user_id, body)

        # ── Delete user ────────────────────────────────────────────────
        if method == "DELETE" and re.match(r".*/admin/users/[^/]+$", path):
            user_id = path.split("/")[-1]
            return _delete_user(user_id)

        # ── Revenue ────────────────────────────────────────────────────
        if method == "GET" and path.endswith("/admin/revenue"):
            return _revenue()

        # ── All campaigns ──────────────────────────────────────────────
        if method == "GET" and path.endswith("/admin/campaigns"):
            return _all_campaigns(qs)

        # ── Usage ranked ──────────────────────────────────────────────
        if method == "GET" and path.endswith("/admin/usage"):
            return _usage()

        return _err(404, "Route not found")

    except Exception as e:
        import traceback; traceback.print_exc()
        return _err(500, str(e))


# ── Auth ──────────────────────────────────────────────────────────────────

def _is_admin(email: str) -> bool:
    """Check app_metadata.role === super_admin in Supabase."""
    if not email:
        return False
    try:
        rows = _sb_get(f"/rest/v1/admin_roles?email=eq.{urllib.parse.quote(email)}&select=role&limit=1")
        # Fallback: look up via auth admin API
    except Exception:
        pass
    # Primary: check auth admin
    try:
        users = _sb_get_auth(f"/auth/v1/admin/users?email={urllib.parse.quote(email)}")
        for u in users.get("users", []):
            if u.get("email") == email:
                return u.get("app_metadata", {}).get("role") == "super_admin"
    except Exception:
        pass
    return False


# ── Overview ──────────────────────────────────────────────────────────────

def _overview():
    users       = _sb_get("/rest/v1/api_keys?select=user_id,active")
    subs        = _sb_get("/rest/v1/subscriptions?select=user_id,status")
    all_users   = _sb_get("/rest/v1/api_keys?select=user_id")

    total_users    = len({u["user_id"] for u in all_users})
    active_subs    = sum(1 for s in subs if s.get("status") == "active")
    active_keys    = sum(1 for k in users if k.get("active"))
    mrr            = active_subs * 999  # R999/month

    # DynamoDB counts
    ext_count  = _dynamo_count(extractions_t)
    seo_count  = _dynamo_count(seo_t)
    camp_count = _dynamo_count(campaigns_t)

    # Recent signups (last 7 days)
    week_ago    = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    recent_keys = _sb_get(f"/rest/v1/api_keys?select=created_at&created_at=gte.{week_ago}")
    new_this_week = len(recent_keys)

    return _ok({
        "total_users":    total_users,
        "active_subs":    active_subs,
        "active_keys":    active_keys,
        "mrr_zar":        mrr,
        "new_this_week":  new_this_week,
        "total_extractions": ext_count,
        "total_seo_scans":   seo_count,
        "total_campaigns":   camp_count,
    })


# ── Users list ────────────────────────────────────────────────────────────

def _list_users(qs):
    limit  = min(int(qs.get("limit", 50)), 200)
    offset = int(qs.get("offset", 0))
    search = qs.get("search", "").strip().lower()

    # Pull all users from Supabase auth
    auth_users = _sb_get_auth("/auth/v1/admin/users?per_page=1000")
    users      = auth_users.get("users", [])

    if search:
        users = [u for u in users if search in u.get("email", "").lower()]

    # Pull subscriptions and api_keys
    subs = {s["user_id"]: s for s in _sb_get("/rest/v1/subscriptions?select=user_id,status,subscription_code")}
    keys = {}
    for k in _sb_get("/rest/v1/api_keys?select=user_id,api_key,active,created_at"):
        uid = k["user_id"]
        if uid not in keys or k.get("active"):
            keys[uid] = k

    result = []
    for u in users[offset:offset + limit]:
        uid  = u["id"]
        sub  = subs.get(uid, {})
        key  = keys.get(uid, {})
        result.append({
            "user_id":     uid,
            "email":       u.get("email"),
            "created_at":  u.get("created_at"),
            "confirmed":   bool(u.get("email_confirmed_at")),
            "role":        u.get("app_metadata", {}).get("role", "user"),
            "sub_status":  sub.get("status", "none"),
            "sub_code":    sub.get("subscription_code", ""),
            "has_key":     bool(key),
            "key_active":  key.get("active", False),
            "api_key_prefix": key.get("api_key", "")[:14] + "…" if key.get("api_key") else None,
        })

    # Sort newest first
    result.sort(key=lambda x: x.get("created_at") or "", reverse=True)

    return _ok({
        "users": result,
        "total": len(users),
        "limit": limit,
        "offset": offset,
    })


# ── User detail ───────────────────────────────────────────────────────────

def _get_user(user_id: str):
    # Auth record
    auth   = _sb_get_auth(f"/auth/v1/admin/users/{user_id}")
    sub    = _sb_get(f"/rest/v1/subscriptions?user_id=eq.{user_id}&select=*&limit=1")
    keys   = _sb_get(f"/rest/v1/api_keys?user_id=eq.{user_id}&select=*&order=created_at.desc")

    # Usage from DynamoDB
    ext_resp  = extractions_t.query(
        IndexName="user_id-index",
        KeyConditionExpression=boto3.dynamodb.conditions.Key("user_id").eq(auth.get("email", "")),
        Select="COUNT",
    ) if auth.get("email") else {"Count": 0}

    seo_resp  = seo_t.query(
        IndexName="user_id-index",
        KeyConditionExpression=boto3.dynamodb.conditions.Key("user_id").eq(auth.get("email", "")),
        Select="COUNT",
    ) if auth.get("email") else {"Count": 0}

    camp_resp = campaigns_t.query(
        IndexName="user_id-index",
        KeyConditionExpression=boto3.dynamodb.conditions.Key("user_id").eq(auth.get("email", "")),
        Limit=5,
    ) if auth.get("email") else {"Items": [], "Count": 0}

    return _ok({
        "user_id":     user_id,
        "email":       auth.get("email"),
        "created_at":  auth.get("created_at"),
        "confirmed":   bool(auth.get("email_confirmed_at")),
        "role":        auth.get("app_metadata", {}).get("role", "user"),
        "subscription": sub[0] if sub else None,
        "api_keys":    _from_dynamo(keys),
        "usage": {
            "extractions": ext_resp.get("Count", 0),
            "seo_scans":   seo_resp.get("Count", 0),
            "campaigns":   camp_resp.get("Count", 0),
            "recent_campaigns": [_from_dynamo(c) for c in camp_resp.get("Items", [])],
        },
    })


# ── Patch API key ─────────────────────────────────────────────────────────

def _patch_key(user_id: str, body: dict):
    active = body.get("active")
    if active is None:
        return _err(400, "Missing 'active' field")

    # Update in Supabase
    _sb_req("PATCH",
            f"/rest/v1/api_keys?user_id=eq.{urllib.parse.quote(user_id)}",
            {"active": active})

    # Update in DynamoDB
    resp = api_keys_t.scan(
        FilterExpression=Attr("user_id").eq(user_id)
    )
    for item in resp.get("Items", []):
        api_keys_t.update_item(
            Key={"api_key": item["api_key"]},
            UpdateExpression="SET active = :a",
            ExpressionAttributeValues={":a": active},
        )

    action = "restored" if active else "revoked"
    return _ok({"user_id": user_id, "key_active": active, "message": f"API key {action}"})


# ── Patch subscription ────────────────────────────────────────────────────

def _patch_subscription(user_id: str, body: dict):
    status = body.get("status")
    if status not in ("active", "inactive"):
        return _err(400, "status must be 'active' or 'inactive'")

    existing = _sb_get(f"/rest/v1/subscriptions?user_id=eq.{user_id}&limit=1&select=id")
    if existing:
        _sb_req("PATCH",
                f"/rest/v1/subscriptions?user_id=eq.{urllib.parse.quote(user_id)}",
                {"status": status})
    else:
        import uuid
        _sb_req("POST", "/rest/v1/subscriptions", {
            "user_id": user_id,
            "subscription_code": f"ADMIN_{uuid.uuid4().hex[:8]}",
            "status": status,
        })

    return _ok({"user_id": user_id, "status": status, "message": f"Subscription set to {status}"})


# ── Delete user ───────────────────────────────────────────────────────────

def _delete_user(user_id: str):
    # Get email first (needed for DynamoDB queries)
    auth = _sb_get_auth(f"/auth/v1/admin/users/{user_id}")
    email = auth.get("email", "")

    # 1. Delete from Supabase (cascades to api_keys + subscriptions via FK)
    _sb_req_auth("DELETE", f"/auth/v1/admin/users/{user_id}")

    # 2. Delete from DynamoDB api_keys table
    resp = api_keys_t.scan(FilterExpression=Attr("user_id").eq(user_id))
    for item in resp.get("Items", []):
        api_keys_t.delete_item(Key={"api_key": item["api_key"]})

    return _ok({"deleted": user_id, "email": email})


# ── Revenue ───────────────────────────────────────────────────────────────

def _revenue():
    if not PAYSTACK_SECRET:
        return _err(500, "Paystack key not configured")

    # Active subscriptions from Supabase
    subs = _sb_get("/rest/v1/subscriptions?status=eq.active&select=user_id,subscription_code,updated_at")

    # Fetch plan details from Paystack
    plan_data = _paystack_get("/plan/PLN_8z6nmuq1xixsur0")
    plan = plan_data.get("data", {})

    # Recent transactions (last 30 days)
    txns = _paystack_get("/transaction?status=success&perPage=50")
    recent_txns = []
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    for t in txns.get("data", []):
        paid_at = t.get("paid_at", "")
        if paid_at:
            try:
                dt = datetime.fromisoformat(paid_at.replace("Z", "+00:00"))
                if dt > cutoff:
                    recent_txns.append({
                        "reference": t.get("reference"),
                        "amount_zar": t.get("amount", 0) / 100,
                        "email":     t.get("customer", {}).get("email"),
                        "paid_at":   paid_at,
                        "status":    t.get("status"),
                    })
            except Exception:
                pass

    active_count = len(subs)
    mrr = active_count * 999

    return _ok({
        "mrr_zar":         mrr,
        "active_subs":     active_count,
        "plan_name":       plan.get("name", "Weblandr Pro"),
        "plan_amount_zar": plan.get("amount", 99900) / 100,
        "subscriptions":   _from_dynamo(subs),
        "recent_transactions": recent_txns[:20],
        "total_revenue_30d": sum(t["amount_zar"] for t in recent_txns),
    })


# ── All campaigns ─────────────────────────────────────────────────────────

def _all_campaigns(qs):
    limit = min(int(qs.get("limit", 50)), 200)
    resp  = campaigns_t.scan(Limit=limit)
    items = sorted(resp.get("Items", []), key=lambda x: x.get("created_at", ""), reverse=True)
    return _ok({"campaigns": [_from_dynamo(i) for i in items], "count": len(items)})


# ── Usage ranked ──────────────────────────────────────────────────────────

def _usage():
    # Scan all tables and aggregate by user_id (email)
    ext_resp  = extractions_t.scan(ProjectionExpression="user_id")
    seo_resp  = seo_t.scan(ProjectionExpression="user_id")
    camp_resp = campaigns_t.scan(
        ProjectionExpression="user_id,sent_count,recipient_count"
    )

    counts: dict = {}

    def _inc(d, user, key, val=1):
        d.setdefault(user, {"extractions": 0, "seo_scans": 0, "campaigns": 0, "emails_sent": 0})
        d[user][key] += val

    for i in ext_resp.get("Items", []):
        _inc(counts, i.get("user_id", ""), "extractions")
    for i in seo_resp.get("Items", []):
        _inc(counts, i.get("user_id", ""), "seo_scans")
    for i in camp_resp.get("Items", []):
        u = i.get("user_id", "")
        _inc(counts, u, "campaigns")
        _inc(counts, u, "emails_sent", int(i.get("sent_count", 0)))

    ranked = sorted(
        [{"user_id": k, **v} for k, v in counts.items()],
        key=lambda x: x["extractions"] + x["seo_scans"] + x["campaigns"],
        reverse=True,
    )

    return _ok({"usage": ranked, "total_users_active": len(ranked)})


# ── Supabase helpers ──────────────────────────────────────────────────────

def _sb_req(method, path, body=None):
    url  = f"{SUPABASE_URL}{path}"
    data = json.dumps(body).encode() if body else None
    req  = urllib.request.Request(url, data=data, method=method)
    req.add_header("apikey",        SUPABASE_SERVICE_KEY)
    req.add_header("Authorization", f"Bearer {SUPABASE_SERVICE_KEY}")
    req.add_header("Content-Type",  "application/json")
    req.add_header("Prefer",        "return=minimal")
    with urllib.request.urlopen(req) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else []


def _sb_req_auth(method, path, body=None):
    url  = f"{SUPABASE_URL}{path}"
    data = json.dumps(body).encode() if body else None
    req  = urllib.request.Request(url, data=data, method=method)
    req.add_header("apikey",        SUPABASE_SERVICE_KEY)
    req.add_header("Authorization", f"Bearer {SUPABASE_SERVICE_KEY}")
    req.add_header("Content-Type",  "application/json")
    with urllib.request.urlopen(req) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else {}


def _sb_get(path):
    url = f"{SUPABASE_URL}{path}"
    req = urllib.request.Request(url, method="GET")
    req.add_header("apikey",        SUPABASE_SERVICE_KEY)
    req.add_header("Authorization", f"Bearer {SUPABASE_SERVICE_KEY}")
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        print(f"Supabase GET {path} → {e.code}: {e.read().decode()}")
        return []


def _sb_get_auth(path):
    url = f"{SUPABASE_URL}{path}"
    req = urllib.request.Request(url, method="GET")
    req.add_header("apikey",        SUPABASE_SERVICE_KEY)
    req.add_header("Authorization", f"Bearer {SUPABASE_SERVICE_KEY}")
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        print(f"Supabase GET {path} → {e.code}: {e.read().decode()}")
        return {}


# ── Paystack helper ───────────────────────────────────────────────────────

def _paystack_get(path):
    url = f"https://api.paystack.co{path}"
    req = urllib.request.Request(url)
    req.add_header("Authorization", f"Bearer {PAYSTACK_SECRET}")
    req.add_header("User-Agent",    "Weblandr/1.0")
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except Exception as e:
        print(f"Paystack {path}: {e}")
        return {}


# ── DynamoDB helpers ──────────────────────────────────────────────────────

def _dynamo_count(table) -> int:
    try:
        return table.scan(Select="COUNT").get("Count", 0)
    except Exception:
        return 0


def _from_dynamo(obj):
    if isinstance(obj, dict):    return {k: _from_dynamo(v) for k, v in obj.items()}
    if isinstance(obj, list):    return [_from_dynamo(v) for v in obj]
    if isinstance(obj, Decimal): return int(obj) if obj == obj.to_integral_value() else float(obj)
    return obj


# ── Response helpers ──────────────────────────────────────────────────────

def _ok(data, status=200):
    return {"statusCode": status, "headers": CORS, "body": json.dumps(data, default=str)}


def _err(code, msg):
    return {"statusCode": code, "headers": CORS, "body": json.dumps({"error": msg})}
