$ErrorActionPreference = 'Continue'
$question = 'What is the average delivery time in the last 3 months?'
for ($i = 1; $i -le 3; $i++) {
  Write-Host "==== RUN $i ===="
  $body = @{ question = $question } | ConvertTo-Json
  $r = Invoke-RestMethod -Method Post -Uri 'http://localhost:4101/api/query' -ContentType 'application/json' -Body $body
  Write-Host "ANSWER: $($r.result.answer)"
  Write-Host ""
}