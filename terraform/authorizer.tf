# ── Package authorizer ────────────────────────────────────────────────────

data "archive_file" "authorizer" {
  type        = "zip"
  output_path = "${path.module}/dist/authorizer.zip"
  source {
    content  = file("${path.module}/authorizer.py")
    filename = "authorizer.py"
  }
}

# ── IAM ───────────────────────────────────────────────────────────────────

resource "aws_iam_role" "authorizer" {
  name = "meshparse-authorizer-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "authorizer_logs" {
  role       = aws_iam_role.authorizer.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "authorizer_dynamodb" {
  name = "meshparse-authorizer-dynamodb"
  role = aws_iam_role.authorizer.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["dynamodb:GetItem"]
      Resource = [aws_dynamodb_table.api_keys.arn]
    }]
  })
}

# ── Lambda ────────────────────────────────────────────────────────────────

resource "aws_lambda_function" "authorizer" {
  function_name    = "meshparse-api-authorizer"
  role             = aws_iam_role.authorizer.arn
  handler          = "authorizer.handler"
  runtime          = "python3.12"
  timeout          = 5
  filename         = data.archive_file.authorizer.output_path
  source_code_hash = data.archive_file.authorizer.output_base64sha256

  environment {
    variables = {
      API_KEYS_TABLE = aws_dynamodb_table.api_keys.name
    }
  }
}

resource "aws_lambda_permission" "authorizer_apigw" {
  statement_id  = "AllowAPIGatewayInvokeAuthorizer"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.authorizer.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}

# ── Attach authorizer to API Gateway ─────────────────────────────────────

resource "aws_apigatewayv2_authorizer" "api_key" {
  api_id                            = aws_apigatewayv2_api.http.id
  authorizer_type                   = "REQUEST"
  name                              = "api-key-authorizer"
  authorizer_uri                    = aws_lambda_function.authorizer.invoke_arn
  authorizer_payload_format_version = "2.0"
  enable_simple_responses           = true
  identity_sources                  = ["$request.header.x-api-key"]
  authorizer_result_ttl_in_seconds  = 300
}

# Explicit POST /emails route with auth (takes precedence over $default)
resource "aws_apigatewayv2_route" "emails_post" {
  api_id             = aws_apigatewayv2_api.http.id
  route_key          = "POST /emails"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorizer_id      = aws_apigatewayv2_authorizer.api_key.id
  authorization_type = "CUSTOM"
}

# GET /health stays on $default (no auth) via Mangum fallthrough
