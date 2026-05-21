"""
Campaign Processor Lambda — SQS consumer.
Sends emails via user-provided SMTP, logs results to DynamoDB.
Triggered in batches of 10 from SQS.
"""
import base64
import json
import os
import re
import smtplib
import ssl
import time
import uuid
from datetime import datetime, timezone, timedelta
from decimal import Decimal
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import boto3

# ── Config ────────────────────────────────────────────────────────────────

CAMPAIGNS_TABLE   = os.environ.get("CAMPAIGNS_TABLE",    "meshparse-campaigns")
LOGS_TABLE        = os.environ.get("EMAIL_LOGS_TABLE",   "meshparse-email-logs")
ACCOUNTS_TABLE    = os.environ.get("MAIL_ACCOUNTS_TABLE","meshparse-mail-accounts")
SUPPRESSION_TABLE = os.environ.get("SUPPRESSION_TABLE",  "meshparse-suppression")
KMS_KEY_ID        = os.environ.get("KMS_KEY_ID", "")
APP_URL           = os.environ.get("APP_URL", "https://meshparse.com")
REGION            = os.environ.get("AWS_REGION", "eu-west-1")

dynamodb = boto3.resource("dynamodb", region_name=REGION)
kms      = boto3.client("kms", region_name=REGION)

campaigns_t   = dynamodb.Table(CAMPAIGNS_TABLE)
logs_t        = dynamodb.Table(LOGS_TABLE)
accounts_t    = dynamodb.Table(ACCOUNTS_TABLE)
suppression_t = dynamodb.Table(SUPPRESSION_TABLE)


# ── Handler ───────────────────────────────────────────────────────────────

def handler(event, context):
    for record in event.get("Records", []):
        try:
            msg = json.loads(record["body"])
            _process_chunk(msg)
        except Exception as e:
            print(f"Failed to process record: {e}")
            raise   # re-raise so SQS retries / sends to DLQ


def _process_chunk(msg):
    campaign_id     = msg["campaign_id"]
    mail_account_id = msg["mail_account_id"]
    recipients      = msg["recipients"]

    # Load campaign + account
    campaign = campaigns_t.get_item(Key={"campaign_id": campaign_id}).get("Item")
    if not campaign:
        print(f"Campaign {campaign_id} not found, skipping")
        return

    account = accounts_t.get_item(Key={"account_id": mail_account_id}).get("Item")
    if not account:
        print(f"Account {mail_account_id} not found, skipping")
        return

    password = _decrypt(account["enc_password"])

    # Mark campaign as sending (idempotent — ignore if already sending)
    campaigns_t.update_item(
        Key={"campaign_id": campaign_id},
        UpdateExpression="SET #s = :s",
        ConditionExpression="attribute_not_exists(#s) OR #s = :q",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={":s": "sending", ":q": "queued"},
    )

    sent    = 0
    bounced = 0
    failed  = 0

    ctx = ssl.create_default_context()
    smtp_conn = None

    try:
        # Open a single SMTP connection for the whole chunk
        smtp_conn = _open_smtp(account, password, ctx)

        for recipient in recipients:
            log_id = str(uuid.uuid4())
            now    = datetime.now(timezone.utc).isoformat()
            expires = int((datetime.now(timezone.utc) + timedelta(days=90)).timestamp())

            # Check suppression list
            if _is_suppressed(recipient):
                _write_log(log_id, campaign_id, account["user_id"],
                           recipient, "suppressed", now, expires)
                continue

            try:
                mime_msg = _build_mime(campaign, account, recipient, log_id)
                smtp_conn.sendmail(account["from_email"], [recipient], mime_msg.as_string())
                _write_log(log_id, campaign_id, account["user_id"],
                           recipient, "sent", now, expires)
                sent += 1
                time.sleep(0.1)   # polite rate limiting

            except smtplib.SMTPRecipientsRefused:
                _write_log(log_id, campaign_id, account["user_id"],
                           recipient, "bounced", now, expires,
                           error="Recipient refused by server")
                _suppress(recipient, "bounce")
                bounced += 1

            except smtplib.SMTPServerDisconnected:
                # Reconnect and retry once
                try:
                    smtp_conn = _open_smtp(account, password, ctx)
                    mime_msg  = _build_mime(campaign, account, recipient, log_id)
                    smtp_conn.sendmail(account["from_email"], [recipient], mime_msg.as_string())
                    _write_log(log_id, campaign_id, account["user_id"],
                               recipient, "sent", now, expires)
                    sent += 1
                except Exception as retry_err:
                    _write_log(log_id, campaign_id, account["user_id"],
                               recipient, "failed", now, expires, error=str(retry_err))
                    failed += 1

            except Exception as e:
                _write_log(log_id, campaign_id, account["user_id"],
                           recipient, "failed", now, expires, error=str(e))
                failed += 1

    finally:
        if smtp_conn:
            try:
                smtp_conn.quit()
            except Exception:
                pass

    # Update campaign counters atomically
    campaigns_t.update_item(
        Key={"campaign_id": campaign_id},
        UpdateExpression=(
            "SET sent_count = sent_count + :s, "
            "bounced_count = bounced_count + :b, "
            "failed_count = failed_count + :f"
        ),
        ExpressionAttributeValues={":s": sent, ":b": bounced, ":f": failed},
    )

    print(f"Chunk done — campaign={campaign_id} sent={sent} bounced={bounced} failed={failed}")


# ── SMTP ──────────────────────────────────────────────────────────────────

def _open_smtp(account, password, ctx):
    host    = account["host"]
    port    = int(account["port"])
    use_tls = account.get("use_tls", True)

    if use_tls:
        smtp = smtplib.SMTP(host, port, timeout=30)
        smtp.ehlo()
        smtp.starttls(context=ctx)
        smtp.ehlo()
    else:
        smtp = smtplib.SMTP_SSL(host, port, context=ctx, timeout=30)

    smtp.login(account["username"], password)
    return smtp


def _build_mime(campaign, account, recipient, log_id):
    msg = MIMEMultipart("alternative")
    msg["Subject"] = campaign["subject"]
    msg["From"]    = (
        f"{account['from_name']} <{account['from_email']}>"
        if account.get("from_name")
        else account["from_email"]
    )
    msg["To"]                = recipient
    msg["List-Unsubscribe"]  = f"<{APP_URL}/unsubscribe?id={log_id}>"
    msg["X-MeshParse-Log"]   = log_id

    # Plain text
    plain = campaign.get("text_body") or _strip_html(campaign["html_body"])
    msg.attach(MIMEText(plain, "plain", "utf-8"))

    # HTML — inject unsubscribe footer
    html = campaign["html_body"] + (
        f'<br><br><hr style="border:none;border-top:1px solid #eee">'
        f'<p style="font-size:12px;color:#999;text-align:center">'
        f'<a href="{APP_URL}/unsubscribe?id={log_id}" style="color:#999">Unsubscribe</a></p>'
    )
    msg.attach(MIMEText(html, "html", "utf-8"))

    return msg


def _strip_html(html: str) -> str:
    return re.sub(r"<[^>]+>", "", html).strip()


# ── DynamoDB helpers ──────────────────────────────────────────────────────

def _write_log(log_id, campaign_id, user_id, recipient, status, sent_at, expires, error=None):
    item = {
        "log_id":      log_id,
        "campaign_id": campaign_id,
        "user_id":     user_id,
        "recipient":   recipient,
        "status":      status,
        "sent_at":     sent_at,
        "expires_at":  expires,
    }
    if error:
        item["error"] = error
    logs_t.put_item(Item=item)


def _is_suppressed(email):
    return bool(suppression_t.get_item(Key={"email": email.lower()}).get("Item"))


def _suppress(email, reason):
    suppression_t.put_item(Item={
        "email":    email.lower(),
        "reason":   reason,
        "added_at": datetime.now(timezone.utc).isoformat(),
    })


# ── KMS ───────────────────────────────────────────────────────────────────

def _decrypt(ciphertext_b64: str) -> str:
    raw = base64.b64decode(ciphertext_b64)
    if not KMS_KEY_ID:
        return raw.decode()
    return kms.decrypt(CiphertextBlob=raw)["Plaintext"].decode()
