resource "aws_dynamodb_table" "users" {
  name         = "meshparse-users"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "email"

  attribute {
    name = "email"
    type = "S"
  }
}

resource "aws_dynamodb_table" "api_keys" {
  name         = "meshparse-api-keys"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "api_key"

  attribute {
    name = "api_key"
    type = "S"
  }

  attribute {
    name = "user_email"
    type = "S"
  }

  global_secondary_index {
    name            = "user_email-index"
    hash_key        = "user_email"
    projection_type = "ALL"
  }
}

resource "aws_dynamodb_table" "subscriptions" {
  name         = "meshparse-subscriptions"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "subscription_code"

  attribute {
    name = "subscription_code"
    type = "S"
  }

  attribute {
    name = "user_email"
    type = "S"
  }

  global_secondary_index {
    name            = "user_email-index"
    hash_key        = "user_email"
    projection_type = "ALL"
  }
}
