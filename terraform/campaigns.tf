# ── KMS key for SMTP password encryption ─────────────────────────────────

resource "aws_kms_key" "campaigns" {
  description             = "MeshParse campaign SMTP credential encryption"
  deletion_window_in_days = 7
  enable_key_rotation     = true
}

resource "aws_kms_alias" "campaigns" {
  name          = "alias/meshparse-campaigns"
  target_key_id = aws_kms_key.campaigns.key_id
}

# ── DynamoDB tables ───────────────────────────────────────────────────────

resource "aws_dynamodb_table" "mail_accounts" {
  name         = "meshparse-mail-accounts"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "account_id"

  attribute {
    name = "account_id"
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
}

resource "aws_dynamodb_table" "campaigns" {
  name         = "meshparse-campaigns"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "campaign_id"

  attribute {
    name = "campaign_id"
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

resource "aws_dynamodb_table" "email_logs" {
  name         = "meshparse-email-logs"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "log_id"

  attribute {
    name = "log_id"
    type = "S"
  }
  attribute {
    name = "campaign_id"
    type = "S"
  }
  attribute {
    name = "sent_at"
    type = "S"
  }

  global_secondary_index {
    name            = "campaign_id-index"
    hash_key        = "campaign_id"
    range_key       = "sent_at"
    projection_type = "ALL"
  }

  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }
}

resource "aws_dynamodb_table" "suppression" {
  name         = "meshparse-suppression"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "email"

  attribute {
    name = "email"
    type = "S"
  }
}

resource "aws_dynamodb_table" "extractions" {
  name         = "meshparse-extractions"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "extraction_id"

  attribute {
    name = "extraction_id"
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

# ── SQS queues ────────────────────────────────────────────────────────────

resource "aws_sqs_queue" "campaign_dlq" {
  name                      = "meshparse-campaign-dlq"
  message_retention_seconds = 1209600  # 14 days
}

resource "aws_sqs_queue" "campaign_send" {
  name                       = "meshparse-campaign-send"
  visibility_timeout_seconds = 120
  message_retention_seconds  = 86400  # 1 day
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.campaign_dlq.arn
    maxReceiveCount     = 3
  })
}

# ── IAM role ──────────────────────────────────────────────────────────────

resource "aws_iam_role" "campaigns" {
  name = "meshparse-campaigns-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "campaigns_logs" {
  role       = aws_iam_role.campaigns.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "campaigns_resources" {
  name = "meshparse-campaigns-resources"
  role = aws_iam_role.campaigns.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["dynamodb:GetItem","dynamodb:PutItem","dynamodb:UpdateItem",
                  "dynamodb:DeleteItem","dynamodb:Query","dynamodb:Scan"]
        Resource = [
          aws_dynamodb_table.mail_accounts.arn,
          "${aws_dynamodb_table.mail_accounts.arn}/index/*",
          aws_dynamodb_table.campaigns.arn,
          "${aws_dynamodb_table.campaigns.arn}/index/*",
          aws_dynamodb_table.email_logs.arn,
          "${aws_dynamodb_table.email_logs.arn}/index/*",
          aws_dynamodb_table.suppression.arn,
          aws_dynamodb_table.extractions.arn,
          "${aws_dynamodb_table.extractions.arn}/index/*",
        ]
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Encrypt","kms:Decrypt","kms:GenerateDataKey"]
        Resource = [aws_kms_key.campaigns.arn]
      },
      {
        Effect   = "Allow"
        Action   = ["sqs:SendMessage","sqs:ReceiveMessage","sqs:DeleteMessage","sqs:GetQueueAttributes"]
        Resource = [aws_sqs_queue.campaign_send.arn, aws_sqs_queue.campaign_dlq.arn]
      },
    ]
  })
}

# ── Lambda packages ───────────────────────────────────────────────────────

data "archive_file" "mail_account" {
  type        = "zip"
  output_path = "${path.module}/dist/mail_account.zip"
  source {
    content  = file("${path.module}/lambdas/mail_account.py")
    filename = "mail_account.py"
  }
}

data "archive_file" "campaign" {
  type        = "zip"
  output_path = "${path.module}/dist/campaign.zip"
  source {
    content  = file("${path.module}/lambdas/campaign.py")
    filename = "campaign.py"
  }
}

data "archive_file" "campaign_processor" {
  type        = "zip"
  output_path = "${path.module}/dist/campaign_processor.zip"
  source {
    content  = file("${path.module}/lambdas/campaign_processor.py")
    filename = "campaign_processor.py"
  }
}

# ── Lambda functions ──────────────────────────────────────────────────────

locals {
  campaign_env = {
    MAIL_ACCOUNTS_TABLE = aws_dynamodb_table.mail_accounts.name
    CAMPAIGNS_TABLE     = aws_dynamodb_table.campaigns.name
    EMAIL_LOGS_TABLE    = aws_dynamodb_table.email_logs.name
    SUPPRESSION_TABLE   = aws_dynamodb_table.suppression.name
    EXTRACTIONS_TABLE   = aws_dynamodb_table.extractions.name
    CAMPAIGN_QUEUE_URL  = aws_sqs_queue.campaign_send.url
    KMS_KEY_ID          = aws_kms_key.campaigns.key_id
    APP_URL             = "https://weblandr.com"
  }
}

resource "aws_lambda_function" "mail_account" {
  function_name    = "meshparse-mail-account"
  role             = aws_iam_role.campaigns.arn
  handler          = "mail_account.handler"
  runtime          = "python3.12"
  timeout          = 60
  memory_size      = 256
  filename         = data.archive_file.mail_account.output_path
  source_code_hash = data.archive_file.mail_account.output_base64sha256
  layers           = [aws_lambda_layer_version.deps.arn]
  environment { variables = local.campaign_env }
}

resource "aws_lambda_function" "campaign" {
  function_name    = "meshparse-campaign"
  role             = aws_iam_role.campaigns.arn
  handler          = "campaign.handler"
  runtime          = "python3.12"
  timeout          = 60
  memory_size      = 256
  filename         = data.archive_file.campaign.output_path
  source_code_hash = data.archive_file.campaign.output_base64sha256
  layers           = [aws_lambda_layer_version.deps.arn]
  environment { variables = local.campaign_env }
}

resource "aws_lambda_function" "campaign_processor" {
  function_name    = "meshparse-campaign-processor"
  role             = aws_iam_role.campaigns.arn
  handler          = "campaign_processor.handler"
  runtime          = "python3.12"
  timeout          = 300
  memory_size      = 512
  filename         = data.archive_file.campaign_processor.output_path
  source_code_hash = data.archive_file.campaign_processor.output_base64sha256
  layers           = [aws_lambda_layer_version.deps.arn]
  environment { variables = local.campaign_env }
}

resource "aws_lambda_event_source_mapping" "campaign_sqs" {
  event_source_arn = aws_sqs_queue.campaign_send.arn
  function_name    = aws_lambda_function.campaign_processor.arn
  batch_size       = 10
  enabled          = true
}

resource "aws_lambda_permission" "mail_account_apigw" {
  statement_id  = "AllowAPIGatewayInvokeMailAccount"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.mail_account.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}

resource "aws_lambda_permission" "campaign_apigw" {
  statement_id  = "AllowAPIGatewayInvokeCampaign"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.campaign.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}

# ── API Gateway ───────────────────────────────────────────────────────────

resource "aws_apigatewayv2_integration" "mail_account" {
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.mail_account.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_integration" "campaign" {
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.campaign.invoke_arn
  payload_format_version = "2.0"
}

# ── Routes — mail accounts ────────────────────────────────────────────────

resource "aws_apigatewayv2_route" "mail_accounts_post" {
  api_id             = aws_apigatewayv2_api.http.id
  route_key          = "POST /mail-accounts"
  target             = "integrations/${aws_apigatewayv2_integration.mail_account.id}"
  authorizer_id      = aws_apigatewayv2_authorizer.api_key.id
  authorization_type = "CUSTOM"
}

resource "aws_apigatewayv2_route" "mail_accounts_get" {
  api_id             = aws_apigatewayv2_api.http.id
  route_key          = "GET /mail-accounts"
  target             = "integrations/${aws_apigatewayv2_integration.mail_account.id}"
  authorizer_id      = aws_apigatewayv2_authorizer.api_key.id
  authorization_type = "CUSTOM"
}

resource "aws_apigatewayv2_route" "mail_account_delete" {
  api_id             = aws_apigatewayv2_api.http.id
  route_key          = "DELETE /mail-accounts/{id}"
  target             = "integrations/${aws_apigatewayv2_integration.mail_account.id}"
  authorizer_id      = aws_apigatewayv2_authorizer.api_key.id
  authorization_type = "CUSTOM"
}

resource "aws_apigatewayv2_route" "mail_account_test" {
  api_id             = aws_apigatewayv2_api.http.id
  route_key          = "POST /mail-accounts/{id}/test"
  target             = "integrations/${aws_apigatewayv2_integration.mail_account.id}"
  authorizer_id      = aws_apigatewayv2_authorizer.api_key.id
  authorization_type = "CUSTOM"
}

# ── Routes — campaigns ────────────────────────────────────────────────────

resource "aws_apigatewayv2_route" "campaigns_post" {
  api_id             = aws_apigatewayv2_api.http.id
  route_key          = "POST /campaigns"
  target             = "integrations/${aws_apigatewayv2_integration.campaign.id}"
  authorizer_id      = aws_apigatewayv2_authorizer.api_key.id
  authorization_type = "CUSTOM"
}

resource "aws_apigatewayv2_route" "campaigns_get" {
  api_id             = aws_apigatewayv2_api.http.id
  route_key          = "GET /campaigns"
  target             = "integrations/${aws_apigatewayv2_integration.campaign.id}"
  authorizer_id      = aws_apigatewayv2_authorizer.api_key.id
  authorization_type = "CUSTOM"
}

resource "aws_apigatewayv2_route" "campaign_get" {
  api_id             = aws_apigatewayv2_api.http.id
  route_key          = "GET /campaigns/{id}"
  target             = "integrations/${aws_apigatewayv2_integration.campaign.id}"
  authorizer_id      = aws_apigatewayv2_authorizer.api_key.id
  authorization_type = "CUSTOM"
}

resource "aws_apigatewayv2_route" "campaign_patch" {
  api_id             = aws_apigatewayv2_api.http.id
  route_key          = "PATCH /campaigns/{id}"
  target             = "integrations/${aws_apigatewayv2_integration.campaign.id}"
  authorizer_id      = aws_apigatewayv2_authorizer.api_key.id
  authorization_type = "CUSTOM"
}

resource "aws_apigatewayv2_route" "campaign_send_route" {
  api_id             = aws_apigatewayv2_api.http.id
  route_key          = "POST /campaigns/{id}/send"
  target             = "integrations/${aws_apigatewayv2_integration.campaign.id}"
  authorizer_id      = aws_apigatewayv2_authorizer.api_key.id
  authorization_type = "CUSTOM"
}

resource "aws_apigatewayv2_route" "campaign_logs_route" {
  api_id             = aws_apigatewayv2_api.http.id
  route_key          = "GET /campaigns/{id}/logs"
  target             = "integrations/${aws_apigatewayv2_integration.campaign.id}"
  authorizer_id      = aws_apigatewayv2_authorizer.api_key.id
  authorization_type = "CUSTOM"
}

resource "aws_apigatewayv2_route" "extraction_get" {
  api_id             = aws_apigatewayv2_api.http.id
  route_key          = "GET /extractions/{id}"
  target             = "integrations/${aws_apigatewayv2_integration.campaign.id}"
  authorizer_id      = aws_apigatewayv2_authorizer.api_key.id
  authorization_type = "CUSTOM"
}

resource "aws_apigatewayv2_route" "extraction_id_options" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "OPTIONS /extractions/{id}"
  target    = "integrations/${aws_apigatewayv2_integration.campaign.id}"
}

resource "aws_apigatewayv2_route" "extractions_get" {
  api_id             = aws_apigatewayv2_api.http.id
  route_key          = "GET /extractions"
  target             = "integrations/${aws_apigatewayv2_integration.campaign.id}"
  authorizer_id      = aws_apigatewayv2_authorizer.api_key.id
  authorization_type = "CUSTOM"
}

# ── CORS OPTIONS ──────────────────────────────────────────────────────────

resource "aws_apigatewayv2_route" "mail_accounts_options" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "OPTIONS /mail-accounts"
  target    = "integrations/${aws_apigatewayv2_integration.mail_account.id}"
}

resource "aws_apigatewayv2_route" "mail_account_id_options" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "OPTIONS /mail-accounts/{id}"
  target    = "integrations/${aws_apigatewayv2_integration.mail_account.id}"
}

resource "aws_apigatewayv2_route" "mail_account_test_options" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "OPTIONS /mail-accounts/{id}/test"
  target    = "integrations/${aws_apigatewayv2_integration.mail_account.id}"
}

resource "aws_apigatewayv2_route" "campaigns_options" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "OPTIONS /campaigns"
  target    = "integrations/${aws_apigatewayv2_integration.campaign.id}"
}

resource "aws_apigatewayv2_route" "campaign_id_options" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "OPTIONS /campaigns/{id}"
  target    = "integrations/${aws_apigatewayv2_integration.campaign.id}"
}

resource "aws_apigatewayv2_route" "campaign_send_options" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "OPTIONS /campaigns/{id}/send"
  target    = "integrations/${aws_apigatewayv2_integration.campaign.id}"
}

resource "aws_apigatewayv2_route" "campaign_logs_options" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "OPTIONS /campaigns/{id}/logs"
  target    = "integrations/${aws_apigatewayv2_integration.campaign.id}"
}

resource "aws_apigatewayv2_route" "extractions_options" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "OPTIONS /extractions"
  target    = "integrations/${aws_apigatewayv2_integration.campaign.id}"
}

# ── Outputs ───────────────────────────────────────────────────────────────

output "campaigns_api_url" {
  value = "${aws_apigatewayv2_stage.default.invoke_url}campaigns"
}
