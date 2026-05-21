terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
    null = {
      source  = "hashicorp/null"
      version = "~> 3.0"
    }
  }

  backend "s3" {
    bucket  = "probility-terraform-state-564663679712"
    key     = "email-extractor/terraform.tfstate"
    region  = "eu-west-1"
    profile = "probility"
  }
}

provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile
}

# ── Packaging ──────────────────────────────────────────────────────────────

# Install dependencies into a build directory for the Lambda layer
resource "null_resource" "pip_install" {
  triggers = {
    requirements = filemd5("${path.module}/../requirements.txt")
  }

  provisioner "local-exec" {
    command = <<-EOT
      rm -rf ${path.module}/build/python
      mkdir -p ${path.module}/build/python
      pip install \
        --platform manylinux2014_x86_64 \
        --target ${path.module}/build/python \
        --implementation cp \
        --python-version 3.12 \
        --only-binary=:all: \
        --upgrade \
        -r ${path.module}/../requirements.txt
    EOT
  }
}

data "archive_file" "layer" {
  type        = "zip"
  source_dir  = "${path.module}/build"
  output_path = "${path.module}/dist/layer.zip"
  depends_on  = [null_resource.pip_install]
}

data "archive_file" "function" {
  type        = "zip"
  output_path = "${path.module}/dist/function.zip"

  source {
    content  = file("${path.module}/../main.py")
    filename = "main.py"
  }
  source {
    content  = file("${path.module}/../scraper.py")
    filename = "scraper.py"
  }
}

# ── Lambda layer (dependencies) ───────────────────────────────────────────

resource "aws_lambda_layer_version" "deps" {
  layer_name          = "${var.function_name}-deps"
  filename            = data.archive_file.layer.output_path
  source_code_hash    = data.archive_file.layer.output_base64sha256
  compatible_runtimes = ["python3.12"]
}

# ── IAM ───────────────────────────────────────────────────────────────────

resource "aws_iam_role" "lambda" {
  name = "${var.function_name}-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "basic_execution" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# ── Lambda function ───────────────────────────────────────────────────────

resource "aws_lambda_function" "api" {
  function_name    = var.function_name
  role             = aws_iam_role.lambda.arn
  handler          = "main.handler"
  runtime          = "python3.12"
  timeout          = var.lambda_timeout
  memory_size      = var.lambda_memory
  filename         = data.archive_file.function.output_path
  source_code_hash = data.archive_file.function.output_base64sha256
  layers           = [aws_lambda_layer_version.deps.arn]

  environment {
    variables = {
      LOG_LEVEL         = "INFO"
      EXTRACTIONS_TABLE = aws_dynamodb_table.extractions.name
    }
  }
}

resource "aws_iam_role_policy" "extractor_dynamo" {
  name = "email-extractor-extractions-dynamo"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["dynamodb:PutItem"]
      Resource = [aws_dynamodb_table.extractions.arn]
    }]
  })
}

# ── API Gateway (HTTP API) ─────────────────────────────────────────────────

resource "aws_apigatewayv2_api" "http" {
  name          = "${var.function_name}-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_headers = ["Content-Type", "Authorization", "X-API-Key"]
    allow_methods = ["GET", "POST", "OPTIONS"]
    allow_origins = ["*"]
    max_age       = 300
  }
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "proxy" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.http.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}
