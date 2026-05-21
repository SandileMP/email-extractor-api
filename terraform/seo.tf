# ── DynamoDB ─────────────────────────────────────────────────────────────

resource "aws_dynamodb_table" "seo_scans" {
  name         = "meshparse-seo-scans"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "scan_id"

  attribute {
    name = "scan_id"
    type = "S"
  }
  attribute {
    name = "user_id"
    type = "S"
  }
  attribute {
    name = "created_at"
    type = "S"
  }

  global_secondary_index {
    name            = "user_id-index"
    hash_key        = "user_id"
    range_key       = "created_at"
    projection_type = "ALL"
  }

  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }
}

# ── IAM ───────────────────────────────────────────────────────────────────

resource "aws_iam_role" "seo_scan" {
  name = "meshparse-seo-scan-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "seo_scan_logs" {
  role       = aws_iam_role.seo_scan.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "seo_scan_dynamo" {
  name = "meshparse-seo-scan-dynamo"
  role = aws_iam_role.seo_scan.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "dynamodb:PutItem",
        "dynamodb:GetItem",
        "dynamodb:Query",
        "dynamodb:UpdateItem",
      ]
      Resource = [
        aws_dynamodb_table.seo_scans.arn,
        "${aws_dynamodb_table.seo_scans.arn}/index/*",
      ]
    }]
  })
}

# ── Lambda package ────────────────────────────────────────────────────────

data "archive_file" "seo_scan" {
  type        = "zip"
  output_path = "${path.module}/dist/seo_scan.zip"
  source {
    content  = file("${path.module}/lambdas/seo_scan.py")
    filename = "seo_scan.py"
  }
}

# ── Lambda function ───────────────────────────────────────────────────────

resource "aws_lambda_function" "seo_scan" {
  function_name    = "meshparse-seo-scan"
  role             = aws_iam_role.seo_scan.arn
  handler          = "seo_scan.handler"
  runtime          = "python3.12"
  timeout          = 60       # deep scans may fetch several pages
  memory_size      = 512
  filename         = data.archive_file.seo_scan.output_path
  source_code_hash = data.archive_file.seo_scan.output_base64sha256
  layers           = [aws_lambda_layer_version.deps.arn]

  environment {
    variables = {
      SEO_SCANS_TABLE = aws_dynamodb_table.seo_scans.name
    }
  }
}

resource "aws_lambda_permission" "seo_scan_apigw" {
  statement_id  = "AllowAPIGatewayInvokeSEO"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.seo_scan.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}

# ── API Gateway integration ───────────────────────────────────────────────

resource "aws_apigatewayv2_integration" "seo_scan" {
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.seo_scan.invoke_arn
  payload_format_version = "2.0"
}

# POST /seo/scan — submit a scan
resource "aws_apigatewayv2_route" "seo_scan_post" {
  api_id             = aws_apigatewayv2_api.http.id
  route_key          = "POST /seo/scan"
  target             = "integrations/${aws_apigatewayv2_integration.seo_scan.id}"
  authorizer_id      = aws_apigatewayv2_authorizer.api_key.id
  authorization_type = "CUSTOM"
}

# GET /seo/scan/{scanId} — retrieve scan by ID
resource "aws_apigatewayv2_route" "seo_scan_get" {
  api_id             = aws_apigatewayv2_api.http.id
  route_key          = "GET /seo/scan/{scanId}"
  target             = "integrations/${aws_apigatewayv2_integration.seo_scan.id}"
  authorizer_id      = aws_apigatewayv2_authorizer.api_key.id
  authorization_type = "CUSTOM"
}

# GET /seo/scans — list user's scans
resource "aws_apigatewayv2_route" "seo_scans_list" {
  api_id             = aws_apigatewayv2_api.http.id
  route_key          = "GET /seo/scans"
  target             = "integrations/${aws_apigatewayv2_integration.seo_scan.id}"
  authorizer_id      = aws_apigatewayv2_authorizer.api_key.id
  authorization_type = "CUSTOM"
}

# OPTIONS for CORS preflight
resource "aws_apigatewayv2_route" "seo_scan_options" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "OPTIONS /seo/scan"
  target    = "integrations/${aws_apigatewayv2_integration.seo_scan.id}"
}

resource "aws_apigatewayv2_route" "seo_scans_options" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "OPTIONS /seo/scans"
  target    = "integrations/${aws_apigatewayv2_integration.seo_scan.id}"
}

# ── Outputs ───────────────────────────────────────────────────────────────

output "seo_scan_url" {
  value = "${aws_apigatewayv2_stage.default.invoke_url}seo/scan"
}
