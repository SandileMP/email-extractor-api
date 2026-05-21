"""
Paystack Webhook Lambda
Handles: subscription.create, charge.success, subscription.disable, subscription.not_renew
"""
import hashlib
import hmac
import json
import os
import uuid
import urllib.error
import urllib.parse
import urllib.request
import boto3

PAYSTACK_SECRET      = os.environ["PAYSTACK_SECRET_KEY"].strip().encode()
SUPABASE_URL         = os.environ["SUPABASE_URL"].strip()
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"].strip()
API_KEYS_TABLE       = os.environ.get("API_KEYS_TABLE", "meshparse-api-keys")
REGION               = os.environ.get("APP_AWS_REGION", "eu-west-1")

dynamodb = boto3.resource("dynamodb", region_name=REGION)
table    = dynamodb.Table(API_KEYS_TABLE)

CORS = {"Content-Type": "application/json"}


# ── Supabase helpers ──────────────────────────────────────────────────────

def _sb_req(method, path, body=None):
    url = f"{SUPABASE_URL}{path}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("apikey", SUPABASE_SERVICE_KEY)
    req.add_header("Authorization", f"Bearer {SUPABASE_SERVICE_KEY}")
    req.add_header("Content-Type", "application/json")
    req.add_header("Prefer", "return=minimal")
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else []
    except urllib.error.HTTPError as e:
        body_text = e.read().decode()
        print(f"Supabase {method} {path} → {e.code}: {body_text}")
        raise


def _sb_get(path):
    url = f"{SUPABASE_URL}{path}"
    req = urllib.request.Request(url, method="GET")
    req.add_header("apikey", SUPABASE_SERVICE_KEY)
    req.add_header("Authorization", f"Bearer {SUPABASE_SERVICE_KEY}")
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        print(f"Supabase GET {path} → {e.code}: {e.read().decode()}")
        return []


def set_subscription(user_id, sub_code, cust_code, status):
    """Upsert: one row per user. PATCH if exists, INSERT if not."""
    existing = _sb_get(f"/rest/v1/subscriptions?user_id=eq.{user_id}&limit=1&select=id")
    payload  = {"subscription_code": sub_code, "customer_code": cust_code, "status": status}
    if existing:
        _sb_req("PATCH", f"/rest/v1/subscriptions?user_id=eq.{urllib.parse.quote(user_id)}", payload)
    else:
        _sb_req("POST", "/rest/v1/subscriptions", {"user_id": user_id, **payload})


def set_subscription_code(user_id, sub_code):
    """Update just the subscription_code (called from subscription.create)."""
    _sb_req("PATCH",
            f"/rest/v1/subscriptions?user_id=eq.{urllib.parse.quote(user_id)}",
            {"subscription_code": sub_code, "status": "active"})


def set_subscription_status(user_id, status):
    _sb_req("PATCH",
            f"/rest/v1/subscriptions?user_id=eq.{urllib.parse.quote(user_id)}",
            {"status": status})


def get_subscription_by_code(sub_code):
    rows = _sb_get(f"/rest/v1/subscriptions?subscription_code=eq.{urllib.parse.quote(sub_code)}&select=user_id")
    return rows[0] if rows else None


def get_active_key(user_id):
    rows = _sb_get(f"/rest/v1/api_keys?user_id=eq.{user_id}&active=eq.true&limit=1&select=api_key")
    return rows[0]["api_key"] if rows else None


def create_api_key(user_id, email):
    key = f"mp_live_{uuid.uuid4().hex}"
    _sb_req("POST", "/rest/v1/api_keys", {"user_id": user_id, "api_key": key, "active": True})
    table.put_item(Item={"api_key": key, "user_email": email, "user_id": user_id, "active": True})
    return key


def deactivate_keys(user_id):
    _sb_req("PATCH",
            f"/rest/v1/api_keys?user_id=eq.{urllib.parse.quote(user_id)}",
            {"active": False})
    resp = table.scan(FilterExpression="user_id = :u",
                      ExpressionAttributeValues={":u": user_id})
    for item in resp.get("Items", []):
        table.update_item(Key={"api_key": item["api_key"]},
                          UpdateExpression="SET active = :f",
                          ExpressionAttributeValues={":f": False})


# ── Handler ───────────────────────────────────────────────────────────────

def handler(event, context):
    raw_body  = event.get("body", "")
    signature = (event.get("headers") or {}).get("x-paystack-signature", "")

    expected = hmac.new(PAYSTACK_SECRET, raw_body.encode(), hashlib.sha512).hexdigest()
    if not hmac.compare_digest(expected, signature):
        print("Invalid signature")
        return {"statusCode": 401, "headers": CORS, "body": json.dumps({"error": "Unauthorized"})}

    ev    = json.loads(raw_body)
    etype = ev.get("event")
    data  = ev.get("data", {})
    meta  = data.get("metadata") or {}
    print(f"Webhook: {etype}")

    try:
        if etype == "subscription.create":
            # Fires after charge.success — carries the real SUB_ code.
            # We update the row that charge.success created (which may have a txn ref as placeholder).
            sub_code = data.get("subscription_code", "")
            user_id  = meta.get("user_id", "")
            if not user_id:
                # Fall back to customer_code lookup
                cust_code = data.get("customer", {}).get("customer_code", "")
                rows = _sb_get(f"/rest/v1/subscriptions?customer_code=eq.{cust_code}&limit=1&select=user_id")
                user_id = rows[0]["user_id"] if rows else ""
            if user_id and sub_code:
                set_subscription_code(user_id, sub_code)
                print(f"subscription.create: updated {user_id} → {sub_code}")

        elif etype == "charge.success" and data.get("plan"):
            email     = data["customer"]["email"].lower()
            sub_code  = data.get("subscription_code") or data.get("reference", "")
            cust_code = data["customer"]["customer_code"]
            user_id   = meta.get("user_id", "")

            if not user_id:
                print(f"No user_id in metadata for {email}")
                return {"statusCode": 200, "headers": CORS, "body": json.dumps({"received": True})}

            # Upsert subscription (one row per user)
            set_subscription(user_id, sub_code, cust_code, "active")

            # Create API key only if none active
            if not get_active_key(user_id):
                key = create_api_key(user_id, email)
                print(f"API key created for {email}: {key[:14]}…")
            else:
                print(f"Active key already exists for {email}")

        elif etype in ("subscription.disable", "subscription.not_renew"):
            sub_code = data.get("subscription_code", "")
            sub = get_subscription_by_code(sub_code)
            if sub:
                set_subscription_status(sub["user_id"], "inactive")
                deactivate_keys(sub["user_id"])
                print(f"Deactivated subscription {sub_code}")
            else:
                # subscription.create may not have fired yet — look up by customer_code
                cust_code = data.get("customer", {}).get("customer_code", "")
                rows = _sb_get(f"/rest/v1/subscriptions?customer_code=eq.{cust_code}&limit=1&select=user_id")
                if rows:
                    uid = rows[0]["user_id"]
                    set_subscription_status(uid, "inactive")
                    deactivate_keys(uid)
                    print(f"Deactivated via customer_code {cust_code}")

    except Exception as exc:
        print(f"Webhook error: {exc}")
        return {"statusCode": 500, "headers": CORS, "body": json.dumps({"error": "Processing error"})}

    return {"statusCode": 200, "headers": CORS, "body": json.dumps({"received": True})}
