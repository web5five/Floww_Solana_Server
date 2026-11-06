# Inspectable wallet-transfer reports

Geondong Kim · November 1, 2026 · AI-02 / AI-03

The AI reference can now present its validated wallet-transfer answer as
Markdown or a standalone HTML report. Each report retains the requested wallet,
data and payment networks, time window, source timestamp, exact per-asset amounts,
and the record references supporting those amounts.

검증을 통과한 지갑 분석 결과를 Markdown·HTML로 출력합니다. 자산별 금액과
근거를 함께 보여주고, 예시 데이터와 부분 수집 결과를 표시합니다.

## Run the offline examples

From the repository root, with Python 3.11 or later and no extra dependencies:

```sh
PYTHONPATH=reference python3 -m ai_baseline.report_demo
PYTHONPATH=reference python3 -m ai_baseline.report_demo --case partial --format html
PYTHONPATH=reference python3 -m ai_baseline.report_demo --case empty-partial
```

To save a report in an existing directory:

```sh
PYTHONPATH=reference python3 -m ai_baseline.report_demo --format html --output 지갑_분석_예시.html
PYTHONPATH=reference python3 -m ai_baseline.report_demo --case partial --output 지갑_부분자료_예시.md
```

The command refuses to overwrite an existing file. It normalizes the new
filename to Unicode NFC and reads its actual filesystem name back for verification.
Existing parent directories keep their names; the command creates no directories.
HTML opens without a server, scripts, external fonts, or network access.

All three examples use the existing scripted proposal and protected-resource
consumption flow. The example body is read only inside the protected-resource
callback, after the existing authorization/payment/delivery gate allows it.
The fixed fixture clock makes the output reproducible. These are synthetic
examples: selection and backend observations are scripted, and no model, API,
payment, or Solana transaction is executed.

## Use with an accepted answer

```python
from ai_baseline.render import render_html, render_markdown

# result comes from consume_analytics(...), after its final access/freshness check.
if result.code == "ANALYTICS_SUMMARY" and result.answer is not None:
    html_document = render_html(result.answer)
    markdown_document = render_markdown(result.answer)
```

Both functions accept an `AnalyticsAnswer`. They reject a raw JSON object,
failure `Result`, or missing answer. This presentation layer adds no data
validation or authorization capability: callers must use the existing
`consume_analytics` boundary, enforce their own access rules for saved output,
and retain the original answer/evidence alongside any export.

## What the reader can inspect

| Report area | Content |
| --- | --- |
| Data and coverage notice | Synthetic status and complete/partial scope before the summary. A non-synthetic flag is attributed to the supplied answer, not described as live verification. |
| Scope | Wallet, data network, payment-network observation, inclusive start, exclusive end, snapshot and generation times. |
| Summary | The accepted answer text, preserved as inert text. |
| Asset totals | Separate asset/direction groups, transfer count, full base-unit integer, display units, decimals, and each group's evidence references. No float conversion or cross-asset sum. |
| Sources and limitations | All supplied report/record/source references and limitations. An empty partial report cannot establish no wallet activity. |

HTML escapes every dynamic value and creates no active references. Markdown
places dynamic labels/references in code spans and the answer in a fenced text
block, including when a string contains HTML, Markdown, backticks, or URL syntax.
References remain inspectable plain text; the renderer neither follows nor
verifies them. This is a first presentation adapter rather than a team frontend
or production report API.

The payment-network field describes the backend observation supplied to the AI
reference. The rendered output is not independent cryptographic settlement or
merchant-delivery proof. Transfer activity is not a wallet balance or profit.

## Verification

```sh
PYTHONPATH=reference python3 -m unittest discover -s reference/tests -v
git diff --check
```

November 1 local verification passed **89 tests: 70 existing tests plus 19 new
presentation/demo tests**. The added checks cover full integer precision, scope
and evidence retention, partial and empty-partial disclosures, hostile markup
and URLs, inert HTML, deterministic output, NFC filenames, no-overwrite behavior,
synthetic data without an inferred offline execution claim, and no protected-body
read when observations indicate DENY, UNKNOWN, or failed
delivery. These checks use the local fixture ports; live model/provider data,
Devnet paid-response settlement, and the shared backend/frontend integration
remain separate acceptance work.

Related: [analytics adapter](AI_ANALYTICS_ADAPTER.md),
[AI workflow](AI-01_WORKFLOW.md).
