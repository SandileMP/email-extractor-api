# ── Shared IAM role for checkout + webhook Lambdas ────────────────────────

resource "aws_iam_role" "api_lambdas" {
  name = "meshparse-api-lambdas-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "api_lambdas_logs" {
  role       = aws_iam_role.api_lambdas.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "api_lambdas_dynamo" {
  name = "meshparse-api-lambdas-dynamo"
  role = aws_iam_role.api_lambdas.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:Scan", "dynamodb:Query"]
      Resource = [
        aws_dynamodb_table.api_keys.arn,
        "${aws_dynamodb_table.api_keys.arn}/index/*",
      ]
    }]
  })
}

# ── Package both Lambdas ──────────────────────────────────────────────────

data "archive_file" "checkout" {
  type        = "zip"
  output_path = "${path.module}/dist/checkout.zip"
  source {
    content  = file("${path.module}/lambdas/checkout.py")
    filename = "checkout.py"
  }
}

data "archive_file" "webhook" {
  type        = "zip"
  output_path = "${path.module}/dist/webhook.zip"
  source {
    content  = file("${path.module}/lambdas/webhook.py")
    filename = "webhook.py"
  }
}

# ── Checkout Lambda ───────────────────────────────────────────────────────

resource "aws_lambda_function" "checkout" {
  function_name    = "meshparse-checkout"
  role             = aws_iam_role.api_lambdas.arn
  handler          = "checkout.handler"
  runtime          = "python3.12"
  timeout          = 15
  filename         = data.archive_file.checkout.output_path
  source_code_hash = data.archive_file.checkout.output_base64sha256

  environment {
    variables = {
      PAYSTACK_SECRET_KEY       = data.aws_ssm_parameter.paystack_secret.value
      PAYSTACK_PLAN_CODE        = "PLN_8z6nmuq1xixsur0" # R999/month MeshParse Pro
      APP_URL                   = "https://meshparse.com"
      SUPABASE_URL              = "https://ajyrrxrxcywooyrahioi.supabase.co"
      SUPABASE_SERVICE_ROLE_KEY = data.aws_ssm_parameter.supabase_service_key.value
    }
  }
}

resource "aws_lambda_permission" "checkout_apigw" {
  statement_id  = "AllowAPIGatewayInvokeCheckout"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.checkout.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}

# ── Webhook Lambda ────────────────────────────────────────────────────────

resource "aws_lambda_function" "webhook" {
  function_name    = "meshparse-webhook"
  role             = aws_iam_role.api_lambdas.arn
  handler          = "webhook.handler"
  runtime          = "python3.12"
  timeout          = 30
  filename         = data.archive_file.webhook.output_path
  source_code_hash = data.archive_file.webhook.output_base64sha256

  environment {
    variables = {
      PAYSTACK_SECRET_KEY       = data.aws_ssm_parameter.paystack_secret.value
      SUPABASE_URL              = "https://ajyrrxrxcywooyrahioi.supabase.co"
      SUPABASE_SERVICE_ROLE_KEY = data.aws_ssm_parameter.supabase_service_key.value
      API_KEYS_TABLE            = aws_dynamodb_table.api_keys.name
      APP_AWS_REGION            = var.aws_region
    }
  }
}

resource "aws_lambda_permission" "webhook_apigw" {
  statement_id  = "AllowAPIGatewayInvokeWebhook"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.webhook.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}

# ── API Gateway integrations + routes ─────────────────────────────────────

resource "aws_apigatewayv2_integration" "checkout" {
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.checkout.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_integration" "webhook" {
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.webhook.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "checkout" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "POST /checkout"
  target    = "integrations/${aws_apigatewayv2_integration.checkout.id}"
}

resource "aws_apigatewayv2_route" "checkout_options" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "OPTIONS /checkout"
  target    = "integrations/${aws_apigatewayv2_integration.checkout.id}"
}

resource "aws_apigatewayv2_route" "cancel" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "POST /cancel"
  target    = "integrations/${aws_apigatewayv2_integration.checkout.id}"
}

resource "aws_apigatewayv2_route" "cancel_options" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "OPTIONS /cancel"
  target    = "integrations/${aws_apigatewayv2_integration.checkout.id}"
}

resource "aws_apigatewayv2_route" "webhook_paystack" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "POST /webhooks/paystack"
  target    = "integrations/${aws_apigatewayv2_integration.webhook.id}"
}

# ── Output ────────────────────────────────────────────────────────────────

output "checkout_url" {
  value = "${aws_apigatewayv2_stage.default.invoke_url}checkout"
}

output "webhook_url" {
  value = "${aws_apigatewayv2_stage.default.invoke_url}webhooks/paystack"
}
