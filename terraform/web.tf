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
  platform     = "WEB_COMPUTE"

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
            baseDirectory: .next
            files:
              - '**/*'
          cache:
            paths:
              - node_modules/**/*
  YAML

  environment_variables = {
    NEXT_PUBLIC_APP_URL          = "https://${var.domain_name}"
    NEXT_PUBLIC_PAYSTACK_PK      = "pk_live_5b9371ddaae8fca03b7bf55f80a247990ac268a0"
    PAYSTACK_PLAN_CODE           = "PLN_bsy0r947pyura5e"
    USERS_TABLE                  = aws_dynamodb_table.users.name
    API_KEYS_TABLE               = aws_dynamodb_table.api_keys.name
    SUBSCRIPTIONS_TABLE          = aws_dynamodb_table.subscriptions.name
    APP_AWS_REGION               = "eu-west-1"
    # Secrets injected below (marked sensitive)
    PAYSTACK_SECRET_KEY          = data.aws_ssm_parameter.paystack_secret.value
    JWT_SECRET                   = data.aws_ssm_parameter.jwt_secret.value
    APP_AWS_ACCESS_KEY_ID        = aws_iam_access_key.web_app.id
    APP_AWS_SECRET_ACCESS_KEY    = aws_iam_access_key.web_app.secret
  }
}

resource "aws_amplify_branch" "main" {
  app_id            = aws_amplify_app.meshparse.id
  branch_name       = "main"
  enable_auto_build = true
  framework         = "Next.js - SSR"
  stage             = "PRODUCTION"
}

resource "aws_amplify_domain_association" "meshparse" {
  app_id      = aws_amplify_app.meshparse.id
  domain_name = var.domain_name
  wait_for_verification = false

  sub_domain {
    branch_name = aws_amplify_branch.main.branch_name
    prefix      = ""
  }

  sub_domain {
    branch_name = aws_amplify_branch.main.branch_name
    prefix      = "www"
  }
}

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
