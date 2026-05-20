"""
Paystack Webhook Lambda — handles subscription lifecycle events.
Verifies HMAC signature, then creates/deactivates API keys in
both Supabase (for the web app) and DynamoDB (for the API Gateway authorizer).
"""
import hashlib
import hmac
import json
import os
import uuid
import urllib.request
import urllib.parse
import boto3

PAYSTACK_SECRET      = os.environ["PAYSTACK_SECRET_KEY"].encode()
SUPABASE_URL         = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
API_KEYS_TABLE       = os.environ.get("API_KEYS_TABLE", "meshparse-api-keys")
REGION               = os.environ.get("APP_AWS_REGION", "eu-west-1")

dynamodb = boto3.resource("dynamodb", region_name=REGION)
table    = dynamodb.Table(API_KEYS_TABLE)

CORS = {"Content-Type": "application/json"}


# ── Supabase helpers ─────────────────────────────────────────────────────────

def _sb(method, path, body=None):
    url = f"{SUPABASE_URL}{path}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("apikey", SUPABASE_SERVICE_KEY)
    req.add_header("Authorization", f"Bearer {SUPABASE_SERVICE_KEY}")
    req.add_header("Content-Type", "application/json")
    req.add_header("Prefer", "return=minimal")
    with urllib.request.urlopen(req) as resp:
        return resp.read()


def _sb_get(path):
    url = f"{SUPABASE_URL}{path}"
    req = urllib.request.Request(url)
    req.add_header("apikey", SUPABASE_SERVICE_KEY)
    req.add_header("Authorization", f"Bearer {SUPABASE_SERVICE_KEY}")
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def get_existing_key(user_id):
    rows = _sb_get(f"/rest/v1/api_keys?user_id=eq.{user_id}&active=eq.true&limit=1&select=api_key")
    return rows[0]["api_key"] if rows else None


def create_supabase_key(user_id, api_key):
    _sb("POST", "/rest/v1/api_keys", {"user_id": user_id, "api_key": api_key, "active": True})


def deactivate_supabase_keys(user_id):
    _sb("PATCH", f"/rest/v1/api_keys?user_id=eq.{user_id}", {"active": False})


def upsert_subscription(user_id, sub_code, customer_code, status):
    _sb("POST", "/rest/v1/subscriptions",
        {"user_id": user_id, "subscription_code": sub_code,
         "customer_code": customer_code, "status": status})


def update_subscription_status(sub_code, status):
    _sb("PATCH", f"/rest/v1/subscriptions?subscription_code=eq.{urllib.parse.quote(sub_code)}",
        {"status": status})


def get_subscription(sub_code):
    rows = _sb_get(f"/rest/v1/subscriptions?subscription_code=eq.{urllib.parse.quote(sub_code)}&select=user_id")
    return rows[0] if rows else None


# ── DynamoDB helpers ─────────────────────────────────────────────────────────

def write_key_to_dynamo(email, user_id, api_key):
    table.put_item(Item={
        "api_key":    api_key,
        "user_email": email,
        "user_id":    user_id,
        "active":     True,
    })


def deactivate_dynamo_keys(user_id):
    resp = table.query(
        IndexName="user_email-index",
        KeyConditionExpression="user_email = :e",
        ExpressionAttributeValues={":e": user_id},
    ) if False else {"Items": []}  # fallback — DynamoDB GSI is on email not user_id
    # Deactivate via scan on user_id (acceptable for low volume)
    resp = table.scan(
        FilterExpression="user_id = :u",
        ExpressionAttributeValues={":u": user_id},
    )
    for item in resp.get("Items", []):
        table.update_item(
            Key={"api_key": item["api_key"]},
            UpdateExpression="SET active = :f",
            ExpressionAttributeValues={":f": False},
        )


# ── Handler ──────────────────────────────────────────────────────────────────

def handler(event, context):
    raw_body  = event.get("body", "")
    signature = (event.get("headers") or {}).get("x-paystack-signature", "")

    # Verify HMAC
    expected = hmac.new(PAYSTACK_SECRET, raw_body.encode(), hashlib.sha512).hexdigest()
    if not hmac.compare_digest(expected, signature):
        print("Invalid Paystack signature")
        return {"statusCode": 401, "headers": CORS, "body": json.dumps({"error": "Unauthorized"})}

    event_data = json.loads(raw_body)
    etype = event_data.get("event")
    data  = event_data.get("data", {})
    print(f"Webhook received: {etype}")

    try:
        if etype == "charge.success" and data.get("plan"):
            email       = data["customer"]["email"].lower()
            sub_code    = data.get("subscription_code") or data.get("reference")
            cust_code   = data["customer"]["customer_code"]
            user_id     = (data.get("metadata") or {}).get("user_id", "")

            if not user_id:
                print(f"No user_id in metadata for {email}, skipping")
                return {"statusCode": 200, "headers": CORS, "body": json.dumps({"received": True})}

            upsert_subscription(user_id, sub_code, cust_code, "active")

            existing = get_existing_key(user_id)
            if not existing:
                api_key = f"mp_live_{uuid.uuid4().hex}"
                create_supabase_key(user_id, api_key)
                write_key_to_dynamo(email, user_id, api_key)
                print(f"API key created for {email}")
            else:
                print(f"API key already exists for {email}")

        elif etype in ("subscription.disable", "subscription.not_renew"):
            sub_code = data.get("subscription_code")
            sub = get_subscription(sub_code)
            if sub:
                update_subscription_status(sub_code, "inactive")
                deactivate_supabase_keys(sub["user_id"])
                deactivate_dynamo_keys(sub["user_id"])
                print(f"Subscription {sub_code} deactivated")

    except Exception as exc:
        print(f"Webhook processing error: {exc}")
        return {"statusCode": 500, "headers": CORS, "body": json.dumps({"error": "Processing error"})}

    return {"statusCode": 200, "headers": CORS, "body": json.dumps({"received": True})}
