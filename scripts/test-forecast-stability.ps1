$ErrorActionPreference = 'Continue'
$questions = @(
  'Predict demand for SKU PAPER-0197 for the next 4 months',
  'Predict demand for SKU CRAYON-0008 for the next 6 months',
  'How much inventory should I plan?'
)
foreach ($q in $questions) {
  for ($i = 1; $i -le 3; $i++) {
    Write-Host "==== '$q' run $i ===="
    $body = @{ question = $q } | ConvertTo-Json
    try {
      $r = Invoke-RestMethod -Method Post -Uri 'http://localhost:4101/api/query' -ContentType 'application/json' -Body $body -TimeoutSec 60
      Write-Host "PROVIDER: $($r.provider)  LLM_USED: $($r.prompt_config.llm_used)"
      Write-Host "ANSWER: $($r.result.answer)"
      if ($r.prompt_config.llm_error) { Write-Host "LLM_ERR: $($r.prompt_config.llm_error)" }
    } catch {
      Write-Host "ERROR: $($_.Exception.Message)"
    }
    Write-Host ""
  }
}