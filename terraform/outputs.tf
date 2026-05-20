output "api_url" {
  description = "HTTPS endpoint for the Email Extractor API"
  value       = aws_apigatewayv2_stage.default.invoke_url
}

output "lambda_function_name" {
  value = aws_lambda_function.api.function_name
}

output "lambda_layer_arn" {
  value = aws_lambda_layer_version.deps.arn
}
