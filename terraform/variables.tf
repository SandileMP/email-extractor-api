variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "eu-west-1"
}

variable "aws_profile" {
  description = "AWS CLI profile to use"
  type        = string
  default     = "probility"
}

variable "function_name" {
  description = "Lambda function name"
  type        = string
  default     = "email-extractor"
}

variable "lambda_timeout" {
  description = "Lambda execution timeout (seconds)"
  type        = number
  default     = 300   # 5 minutes — gives scraper full room; API GW caps client-facing calls at 29 s
}

variable "lambda_memory" {
  description = "Lambda memory (MB)"
  type        = number
  default     = 512
}
