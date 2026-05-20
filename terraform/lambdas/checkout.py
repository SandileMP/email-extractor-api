"""
Checkout Lambda — initializes a Paystack subscription transaction.
Called directly from the browser (CORS-enabled).
Accepts: {"email": "user@example.com", "user_id": "<supabase-uuid>"}
Returns: {"url": "<paystack-checkout-url>"}
"""
import json
import os
import urllib.error
import urllib.request

PAYSTACK_SECRET = os.environ["PAYSTACK_SECRET_KEY"].strip()
PLAN_CODE       = os.environ["PAYSTACK_PLAN_CODE"].strip()
APP_URL         = os.environ["APP_URL"].strip()

CORS = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Content-Type": "application/json",
}


def handler(event, context):
    method = event.get("requestContext", {}).get("http", {}).get("method", "")

    if method == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    try:
        body = json.loads(event.get("body") or "{}")
        email   = body.get("email", "").lower().strip()
        user_id = body.get("user_id", "")

        if not email or not user_id:
            return _err(400, "email and user_id required")

        payload = json.dumps({
            "email":        email,
            "amount":       75000,   # R750.00 in kobo/cents
            "currency":     "ZAR",
            "plan":         PLAN_CODE,
            "callback_url": f"{APP_URL}/dashboard?payment=success",
            "metadata":     {"user_email": email, "user_id": user_id},
        }).encode()

        req = urllib.request.Request(
            "https://api.paystack.co/transaction/initialize",
            data=payload,
            method="POST",
        )
        req.add_header("Authorization", f"Bearer {PAYSTACK_SECRET}")
        req.add_header("Content-Type", "application/json")
        req.add_header("User-Agent", "Mozilla/5.0 (compatible; MeshParse/1.0)")
        req.add_header("Accept", "application/json")
        try:
            with urllib.request.urlopen(req) as resp:
                result = json.loads(resp.read())
        except urllib.error.HTTPError as e:
            body = e.read().decode()
            print(f"Paystack HTTP {e.code}: {body}")
            return _err(502, f"Paystack error {e.code}")

        if not result.get("status"):
            return _err(502, result.get("message", "Paystack error"))

        return {
            "statusCode": 200,
            "headers": CORS,
            "body": json.dumps({"url": result["data"]["authorization_url"]}),
        }

    except Exception as exc:
        print(f"Checkout error: {exc}")
        return _err(500, "Server error")


def _err(code, msg):
    return {"statusCode": code, "headers": CORS, "body": json.dumps({"error": msg})}
