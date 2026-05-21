"""
Checkout + Subscription Management Lambda.
Routes by path:
  POST /checkout → initialize Paystack subscription transaction
  POST /cancel   → disable active Paystack subscription
"""
import json
import os
import urllib.error
import urllib.request

PAYSTACK_SECRET = os.environ["PAYSTACK_SECRET_KEY"].strip()
PLAN_CODE       = os.environ["PAYSTACK_PLAN_CODE"].strip()
APP_URL         = os.environ["APP_URL"].strip()
SUPABASE_URL    = os.environ.get("SUPABASE_URL", "").strip()
SUPABASE_SVC    = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()

CORS = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Content-Type": "application/json",
}


# ── HTTP helpers ──────────────────────────────────────────────────────────

def _paystack(method, path, body=None):
    url = f"https://api.paystack.co{path}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {PAYSTACK_SECRET}")
    req.add_header("Content-Type", "application/json")
    req.add_header("User-Agent", "Mozilla/5.0 (compatible; MeshParse/1.0)")
    req.add_header("Accept", "application/json")
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body_text = e.read().decode()
        print(f"Paystack {method} {path} → {e.code}: {body_text}")
        raise


def _supabase_get(path):
    url = f"{SUPABASE_URL}{path}"
    req = urllib.request.Request(url, method="GET")
    req.add_header("apikey", SUPABASE_SVC)
    req.add_header("Authorization", f"Bearer {SUPABASE_SVC}")
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def _supabase_patch(path, body):
    url = f"{SUPABASE_URL}{path}"
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="PATCH")
    req.add_header("apikey", SUPABASE_SVC)
    req.add_header("Authorization", f"Bearer {SUPABASE_SVC}")
    req.add_header("Content-Type", "application/json")
    req.add_header("Prefer", "return=minimal")
    with urllib.request.urlopen(req) as resp:
        return resp.read()


# ── Handlers ──────────────────────────────────────────────────────────────

def handle_checkout(body):
    email   = body.get("email", "").lower().strip()
    user_id = body.get("user_id", "").strip()
    if not email or not user_id:
        return _err(400, "email and user_id required")

    result = _paystack("POST", "/transaction/initialize", {
        "email":        email,
        "amount":       int(PLAN_CODE and 1000),  # overridden by plan
        "currency":     "ZAR",
        "plan":         PLAN_CODE,
        "callback_url": f"{APP_URL}/dashboard?payment=success",
        "metadata":     {"user_email": email, "user_id": user_id},
    })
    if not result.get("status"):
        return _err(502, result.get("message", "Paystack error"))
    return _ok({"url": result["data"]["authorization_url"]})


def handle_cancel(body):
    user_id = body.get("user_id", "").strip()
    if not user_id:
        return _err(400, "user_id required")

    # Get subscription from Supabase
    rows = _supabase_get(
        f"/rest/v1/subscriptions?user_id=eq.{user_id}&status=eq.active&limit=1&select=subscription_code"
    )
    if not rows:
        return _err(404, "No active subscription found")

    sub_code = rows[0]["subscription_code"]

    # Get email_token from Paystack
    details = _paystack("GET", f"/subscription/{sub_code}")
    if not details.get("status"):
        return _err(502, "Could not fetch subscription details")

    email_token = details["data"].get("email_token")
    if not email_token:
        return _err(502, "Missing email token from Paystack")

    # Disable on Paystack — webhook will handle deactivating keys
    result = _paystack("POST", "/subscription/disable", {
        "code":  sub_code,
        "token": email_token,
    })
    if not result.get("status"):
        return _err(502, result.get("message", "Could not cancel subscription"))

    # Optimistically update Supabase status
    import urllib.parse
    _supabase_patch(
        f"/rest/v1/subscriptions?subscription_code=eq.{urllib.parse.quote(sub_code)}",
        {"status": "inactive"},
    )

    return _ok({"cancelled": True})


# ── Router ────────────────────────────────────────────────────────────────

def handler(event, context):
    path   = event.get("rawPath", "")
    method = event.get("requestContext", {}).get("http", {}).get("method", "")

    if method == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    try:
        body = json.loads(event.get("body") or "{}")
    except Exception:
        return _err(400, "Invalid JSON")

    try:
        if "/cancel" in path:
            return handle_cancel(body)
        return handle_checkout(body)
    except urllib.error.HTTPError:
        return _err(502, "Upstream error")
    except Exception as exc:
        print(f"Error: {exc}")
        return _err(500, "Server error")


def _ok(data):
    return {"statusCode": 200, "headers": CORS, "body": json.dumps(data)}

def _err(code, msg):
    return {"statusCode": code, "headers": CORS, "body": json.dumps({"error": msg})}
