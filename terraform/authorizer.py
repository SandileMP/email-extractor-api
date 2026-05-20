import os
import boto3

dynamodb = boto3.resource("dynamodb", region_name="eu-west-1")
table = dynamodb.Table(os.environ["API_KEYS_TABLE"])


def handler(event, context):
    api_key = (event.get("headers") or {}).get("x-api-key", "")

    if not api_key:
        return {"isAuthorized": False}

    try:
        resp = table.get_item(Key={"api_key": api_key})
        item = resp.get("Item")
        if item and item.get("active"):
            return {
                "isAuthorized": True,
                "context": {"user_email": item.get("user_email", "")},
            }
    except Exception as exc:
        print(f"Authorizer error: {exc}")

    return {"isAuthorized": False}
