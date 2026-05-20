provider "aws" {
  alias   = "us_east_1"
  region  = "us-east-1"
  profile = var.aws_profile
}

variable "domain_name" {
  default = "meshparse.com"
}

variable "github_token" {
  description = "GitHub personal access token for Amplify"
  type        = string
  sensitive   = true
  default     = ""
}

# ── SSM secrets (read back for Amplify env) ───────────────────────────────

data "aws_ssm_parameter" "paystack_secret" {
  name            = "/scrapify/paystack-secret-key"
  with_decryption = true
}

data "aws_ssm_parameter" "jwt_secret" {
  name            = "/scrapify/jwt-secret"
  with_decryption = true
}

data "aws_ssm_parameter" "supabase_service_key" {
  name            = "/meshparse/supabase-service-role-key"
  with_decryption = true
}

# ── IAM user for web app → DynamoDB ──────────────────────────────────────

resource "aws_iam_user" "web_app" {
  name = "meshparse-web-app"
}

resource "aws_iam_access_key" "web_app" {
  user = aws_iam_user.web_app.name
}

resource "aws_iam_user_policy" "web_app_dynamodb" {
  name = "meshparse-web-dynamodb"
  user = aws_iam_user.web_app.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
        "dynamodb:Query",
      ]
      Resource = [
        aws_dynamodb_table.users.arn,
        "${aws_dynamodb_table.users.arn}/index/*",
        aws_dynamodb_table.api_keys.arn,
        "${aws_dynamodb_table.api_keys.arn}/index/*",
        aws_dynamodb_table.subscriptions.arn,
        "${aws_dynamodb_table.subscriptions.arn}/index/*",
      ]
    }]
  })
}

# ── Route 53 ─────────────────────────────────────────────────────────────

resource "aws_route53_zone" "meshparse" {
  name = var.domain_name
}

# ── ACM certificate (must be us-east-1 for Amplify) ──────────────────────

resource "aws_acm_certificate" "meshparse" {
  provider                  = aws.us_east_1
  domain_name               = var.domain_name
  subject_alternative_names = ["*.${var.domain_name}"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.meshparse.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      type   = dvo.resource_record_type
      record = dvo.resource_record_value
    }
  }
  zone_id         = aws_route53_zone.meshparse.zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.record]
  ttl             = 60
  allow_overwrite = true
}

# Note: aws_acm_certificate_validation is intentionally omitted.
# The cert validates automatically once DNS propagates (meshparse.com is registered via Route 53).
# Check status: aws acm describe-certificate --certificate-arn <arn> --region us-east-1

# ── Amplify app ───────────────────────────────────────────────────────────

resource "aws_amplify_app" "meshparse" {
  name         = "meshparse"
  repository   = "https://github.com/SandileMP/email-extractor-api"
  access_token = var.github_token
  platform     = "WEB"  # Static hosting — no SSR Lambda

  build_spec = <<-YAML
    version: 1
    applications:
      - appRoot: web
        frontend:
          phases:
            preBuild:
              commands:
                - npm ci
            build:
              commands:
                - npm run build
          artifacts:
            baseDirectory: out
            files:
              - '**/*'
          cache:
            paths:
              - node_modules/**/*
  YAML

  # Only NEXT_PUBLIC_ vars needed — baked into static bundle at build time
  environment_variables = {
    NEXT_PUBLIC_APP_URL            = "https://${var.domain_name}"
    NEXT_PUBLIC_SUPABASE_URL       = "https://ajyrrxrxcywooyrahioi.supabase.co"
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFqeXJyeHJ4Y3l3b295cmFoaW9pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzMDQzNTIsImV4cCI6MjA5NDg4MDM1Mn0.XDu6729rTcHL5M9boQPaB3puoQdvQpWnnqCuHX3B_VI"
    NEXT_PUBLIC_CHECKOUT_URL       = "${aws_apigatewayv2_stage.default.invoke_url}checkout"
  }
}

# Branch and domain association managed outside Terraform
# (Amplify auto-creates branches on push; domain managed via console)

# Domain association managed via Amplify console after domain validates

# ── Outputs ───────────────────────────────────────────────────────────────

output "amplify_app_id" {
  value = aws_amplify_app.meshparse.id
}

output "amplify_default_domain" {
  value = aws_amplify_app.meshparse.default_domain
}

output "route53_nameservers" {
  description = "Point your domain registrar to these nameservers"
  value       = aws_route53_zone.meshparse.name_servers
}

output "web_app_access_key_id" {
  value     = aws_iam_access_key.web_app.id
  sensitive = true
}
