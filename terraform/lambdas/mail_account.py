"""
Mail Account Lambda — manages user SMTP credentials.
Routes:
  POST   /mail-accounts           create + test + store
  GET    /mail-accounts           list user's accounts
  DELETE /mail-accounts/{id}      remove account
  POST   /mail-accounts/{id}/test re-test existing account
"""
import base64
import json
import os
import re
import smtplib
import ssl
import traceback
import uuid
from datetime import datetime, timezone

import boto3
from boto3.dynamodb.conditions import Key

# ── Config ────────────────────────────────────────────────────────────────

ACCOUNTS_TABLE = os.environ.get("MAIL_ACCOUNTS_TABLE", "meshparse-mail-accounts")
KMS_KEY_ID     = os.environ.get("KMS_KEY_ID", "")
REGION         = os.environ.get("AWS_REGION", "eu-west-1")

dynamodb = boto3.resource("dynamodb", region_name=REGION)
table    = dynamodb.Table(ACCOUNTS_TABLE)
kms      = boto3.client("kms", region_name=REGION)

CORS = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Headers": "Content-Type,X-API-Key",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Content-Type": "application/json",
}

REQUIRED = {"host", "port", "username", "password", "from_email"}


# ── Handler ───────────────────────────────────────────────────────────────

def handler(event, context):
    method   = event.get("requestContext", {}).get("http", {}).get("method", "")
    path     = event.get("rawPath", "")
    user_id  = event.get("requestContext", {}).get("authorizer", {}).get("lambda", {}).get("user_email", "anon")

    if method == "OPTIONS":
        return _ok({})

    try:
        if method == "POST" and path.endswith("/test"):
            account_id = path.split("/")[-2]
            return _test_existing(account_id, user_id)

        if method == "POST" and path.rstrip("/").endswith("mail-accounts"):
            body = json.loads(event.get("body") or "{}")
            return _create(body, user_id)

        if method == "GET":
            return _list(user_id)

        if method == "DELETE":
            account_id = path.split("/")[-1]
            return _delete(account_id, user_id)

        return _err(404, "Route not found")

    except Exception as e:
        traceback.print_exc()
        return _err(500, str(e))


# ── Create ────────────────────────────────────────────────────────────────

def _create(body, user_id):
    missing = REQUIRED - body.keys()
    if missing:
        return _err(400, f"Missing required fields: {', '.join(sorted(missing))}")

    if not _valid_email(body["from_email"]):
        return _err(400, f"Invalid from_email: {body['from_email']!r}")

    port = int(body.get("port", 587))
    use_tls = body.get("use_tls", port != 465)

    # Test connection before storing
    error = _smtp_test(body["host"], port, body["username"],
                       body["password"], body["from_email"], use_tls)
    if error:
        return _err(400, f"SMTP connection failed: {error}")

    # Encrypt password with KMS
    enc_password = _encrypt(body["password"])

    account_id = str(uuid.uuid4())
    item = {
        "account_id":        account_id,
        "user_id":           user_id,
        "name":              body.get("name", body["from_email"]),
        "host":              body["host"],
        "port":              port,
        "username":          body["username"],
        "enc_password":      enc_password,
        "from_email":        body["from_email"],
        "from_name":         body.get("from_name", ""),
        "use_tls":           use_tls,
        "verified":          True,
        "created_at":        datetime.now(timezone.utc).isoformat(),
    }
    table.put_item(Item=item)

    return _ok(_safe(item), status=201)


# ── List ──────────────────────────────────────────────────────────────────

def _list(user_id):
    resp  = table.query(
        IndexName="user_id-index",
        KeyConditionExpression=Key("user_id").eq(user_id),
        ScanIndexForward=False,
    )
    accounts = [_safe(i) for i in resp.get("Items", [])]
    return _ok({"accounts": accounts})


# ── Delete ────────────────────────────────────────────────────────────────

def _delete(account_id, user_id):
    item = table.get_item(Key={"account_id": account_id}).get("Item")
    if not item or item.get("user_id") != user_id:
        return _err(404, "Account not found")
    table.delete_item(Key={"account_id": account_id})
    return _ok({"deleted": account_id})


# ── Test existing ─────────────────────────────────────────────────────────

def _test_existing(account_id, user_id):
    item = table.get_item(Key={"account_id": account_id}).get("Item")
    if not item or item.get("user_id") != user_id:
        return _err(404, "Account not found")

    password = _decrypt(item["enc_password"])
    error = _smtp_test(item["host"], int(item["port"]), item["username"],
                       password, item["from_email"], item.get("use_tls", True))
    if error:
        table.update_item(
            Key={"account_id": account_id},
            UpdateExpression="SET verified = :f",
            ExpressionAttributeValues={":f": False},
        )
        return _err(400, f"Connection failed: {error}")

    table.update_item(
        Key={"account_id": account_id},
        UpdateExpression="SET verified = :t",
        ExpressionAttributeValues={":t": True},
    )
    return _ok({"verified": True, "account_id": account_id})


# ── SMTP test ─────────────────────────────────────────────────────────────

def _smtp_test(host, port, username, password, from_email, use_tls):
    try:
        ctx = ssl.create_default_context()
        if use_tls:
            with smtplib.SMTP(host, port, timeout=15) as smtp:
                smtp.ehlo()
                smtp.starttls(context=ctx)
                smtp.ehlo()
                smtp.login(username, password)
        else:
            with smtplib.SMTP_SSL(host, port, context=ctx, timeout=15) as smtp:
                smtp.login(username, password)
        return None   # success
    except smtplib.SMTPAuthenticationError:
        return "Authentication failed — check username and password"
    except smtplib.SMTPConnectError:
        return f"Could not connect to {host}:{port}"
    except TimeoutError:
        return f"Connection to {host}:{port} timed out"
    except Exception as e:
        return str(e)


# ── KMS helpers ───────────────────────────────────────────────────────────

def _encrypt(plaintext: str) -> str:
    if not KMS_KEY_ID:
        return base64.b64encode(plaintext.encode()).decode()  # dev fallback
    resp = kms.encrypt(KeyId=KMS_KEY_ID, Plaintext=plaintext.encode())
    return base64.b64encode(resp["CiphertextBlob"]).decode()


def _decrypt(ciphertext_b64: str) -> str:
    raw = base64.b64decode(ciphertext_b64)
    if not KMS_KEY_ID:
        return raw.decode()  # dev fallback
    resp = kms.decrypt(CiphertextBlob=raw)
    return resp["Plaintext"].decode()


# ── Helpers ───────────────────────────────────────────────────────────────

def _safe(item):
    """Strip encrypted password before returning to client."""
    return {k: v for k, v in item.items() if k != "enc_password"}


def _valid_email(email: str) -> bool:
    return bool(re.match(r"^[^@]+@[^@]+\.[^@]+$", email))


def _ok(data, status=200):
    return {"statusCode": status, "headers": CORS, "body": json.dumps(data)}


def _err(code, msg):
    return {"statusCode": code, "headers": CORS, "body": json.dumps({"error": msg})}
