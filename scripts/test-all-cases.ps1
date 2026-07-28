$ErrorActionPreference = 'Stop'
$cases = @(
  @{ id='tc-01'; q='Show delayed orders by week for the last 3 months';                                  expect='There are 10 delayed orders in the last 3 months. The peak week is 2025-W41 with 2 delays.' },
  @{ id='tc-02'; q='Which carrier has the highest delay rate?';                                          expect='The carrier with the highest delay rate is USPS at 26.7% over the last 3 months.' },
  @{ id='tc-03'; q='Which route has the highest total order value in the last 3 months?';               expect='The route with the highest total order value is Newark, NJ -> Boston, MA at 628.17 USD.' },
  @{ id='tc-04'; q='Give me a summary of order status for the last 3 months';                            expect='In the last 3 months there are 74 orders, 56 delivered, 10 delayed, with an on-time rate of 75.7%.' },
  @{ id='tc-05'; q='How many orders were delivered late last month?';                                    expect='In 2025-12 (calendar month of the latest order in the dataset), 3 orders have status "delayed" (24 orders placed that month).' },
  @{ id='tc-06'; q='How many exception orders are in the last 3 months?';                                expect='In the last 3 months there are 1 order with status "exception".' },
  @{ id='tc-07'; q='How many in-transit orders are in the last 3 months?';                               expect='In the last 3 months there are 7 orders currently marked "in_transit".' },
  @{ id='tc-08'; q='What is the average delivery time in the last 3 months?';                           expect='Average delivery time in the last 3 months is 3.5 days (order_date to delivery_date, orders with both dates).' },
  @{ id='tc-09'; q='Which region has the most orders in the last 3 months?';                            expect='The region with the most orders in the last 3 months is US-E with 26 orders.' },
  @{ id='tc-10'; q='How many promotional orders were placed in the last 3 months?';                      expect='In the last 3 months, 10 of 74 orders used a promotion (is_promo=1).' },
  @{ id='fc-01'; q='Predict demand for SKU PAPER-0197 for the next 4 months';                            expect='forecast for paper 0197' },
  @{ id='fc-02'; q='How much inventory should I plan?';                                                  expect='inventory recommendation' }
)

function Eval-Match($expected, $actual) {
  $normalize = { param($s) ($s.ToLower() -replace '[^a-z0-9\s]',' ' -replace '\s+',' ').Trim() }
  $e = & $normalize $expected
  $a = & $normalize $actual
  if ($e -eq $a) { return @{ status='exact'; score=1.0 } }
  $eTokens = @($e.Split(' ', [System.StringSplitOptions]::RemoveEmptyEntries))
  $aTokens = @($a.Split(' ', [System.StringSplitOptions]::RemoveEmptyEntries))
  if ($eTokens.Count -eq 0) { return @{ status='mismatch'; score=0.0 } }
  $overlap = ($eTokens | Where-Object { $aTokens -contains $_ }).Count
  $score = $overlap / $eTokens.Count
  if ($score -ge 0.6) { return @{ status='partial'; score=$score } }
  return @{ status='mismatch'; score=$score }
}

$pass = 0; $partial = 0; $fail = 0
foreach ($c in $cases) {
  $body = @{ question = $c.q } | ConvertTo-Json
  try {
    $r = Invoke-RestMethod -Method Post -Uri 'http://localhost:4101/api/query' -ContentType 'application/json' -Body $body -TimeoutSec 60
    $actual = $r.result.answer
    $match = Eval-Match $c.expect $actual
    $status = $match.status
    $score = [math]::Round($match.score, 2)
    $provider = $r.provider
    $llmUsed = $r.prompt_config.llm_used
    $llmErr = $r.prompt_config.llm_error
    if ($status -eq 'exact') { $pass++ } elseif ($status -eq 'partial') { $partial++ } else { $fail++ }
    "{0,-6} [{1,-7}] score={2,-4} provider={3,-10} llm_used={4,-5} Q: {5}" -f $c.id, $status, $score, $provider, $llmUsed, $c.q
    "       EXPECT: $($c.expect)"
    "       ACTUAL: $actual"
    if ($llmErr) { "       LLM_ERR: $llmErr" }
    ""
  } catch {
    $fail++
    "{0,-6} [error  ] $($_.Exception.Message)" -f $c.id
  }
}

"============================================="
"EXACT: $pass  PARTIAL: $partial  MISMATCH: $fail  TOTAL: $($cases.Count)"
"============================================="