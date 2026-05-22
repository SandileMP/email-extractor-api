# ── Admin Lambda ──────────────────────────────────────────────────────────

data "archive_file" "admin" {
  type        = "zip"
  output_path = "${path.module}/dist/admin.zip"
  source {
    content  = file("${path.module}/lambdas/admin.py")
    filename = "admin.py"
  }
}

resource "aws_lambda_function" "admin" {
  function_name    = "meshparse-admin"
  role             = aws_iam_role.campaigns.arn   # reuse campaigns role (has DynamoDB + SQS)
  handler          = "admin.handler"
  runtime          = "python3.12"
  timeout          = 30
  memory_size      = 256
  filename         = data.archive_file.admin.output_path
  source_code_hash = data.archive_file.admin.output_base64sha256

  environment {
    variables = {
      SUPABASE_URL              = "https://ajyrrxrxcywooyrahioi.supabase.co"
      SUPABASE_SERVICE_ROLE_KEY = data.aws_ssm_parameter.supabase_service_key.value
      PAYSTACK_SECRET_KEY       = data.aws_ssm_parameter.paystack_secret.value
      CAMPAIGNS_TABLE           = aws_dynamodb_table.campaigns.name
      EMAIL_LOGS_TABLE          = aws_dynamodb_table.email_logs.name
      EXTRACTIONS_TABLE         = aws_dynamodb_table.extractions.name
      SEO_SCANS_TABLE           = "meshparse-seo-scans"
      API_KEYS_TABLE            = aws_dynamodb_table.api_keys.name
    }
  }
}

resource "aws_lambda_permission" "admin_apigw" {
  statement_id  = "AllowAPIGatewayInvokeAdmin"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.admin.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}

# Extra IAM — admin needs to read api_keys DynamoDB table
resource "aws_iam_role_policy" "admin_api_keys" {
  name = "meshparse-admin-api-keys"
  role = aws_iam_role.campaigns.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["dynamodb:Scan","dynamodb:GetItem","dynamodb:UpdateItem","dynamodb:DeleteItem"]
      Resource = [aws_dynamodb_table.api_keys.arn]
    }]
  })
}

# ── Integration ───────────────────────────────────────────────────────────

resource "aws_apigatewayv2_integration" "admin" {
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.admin.invoke_arn
  payload_format_version = "2.0"
}

# ── Routes ────────────────────────────────────────────────────────────────

locals {
  admin_routes = [
    "GET /admin/overview",
    "GET /admin/users",
    "GET /admin/users/{id}",
    "PATCH /admin/users/{id}/key",
    "PATCH /admin/users/{id}/subscription",
    "DELETE /admin/users/{id}",
    "GET /admin/revenue",
    "GET /admin/campaigns",
    "GET /admin/usage",
  ]
}

resource "aws_apigatewayv2_route" "admin" {
  for_each           = toset(local.admin_routes)
  api_id             = aws_apigatewayv2_api.http.id
  route_key          = each.value
  target             = "integrations/${aws_apigatewayv2_integration.admin.id}"
  authorizer_id      = aws_apigatewayv2_authorizer.api_key.id
  authorization_type = "CUSTOM"
}

# OPTIONS preflight (unauthenticated) for each admin path
locals {
  admin_options = [
    "OPTIONS /admin/overview",
    "OPTIONS /admin/users",
    "OPTIONS /admin/users/{id}",
    "OPTIONS /admin/users/{id}/key",
    "OPTIONS /admin/users/{id}/subscription",
    "OPTIONS /admin/revenue",
    "OPTIONS /admin/campaigns",
    "OPTIONS /admin/usage",
  ]
}

resource "aws_apigatewayv2_route" "admin_options" {
  for_each  = toset(local.admin_options)
  api_id    = aws_apigatewayv2_api.http.id
  route_key = each.value
  target    = "integrations/${aws_apigatewayv2_integration.admin.id}"
}

