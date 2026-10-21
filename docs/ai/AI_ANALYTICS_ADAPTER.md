# Wallet analytics: validation and evidence-linked results

Geondong Kim · October 21, 2026 · AI-01 / AI-02 / AI-03

**The AI component can now validate a bounded wallet-transfer report and produce
exact totals with references to the underlying records.** It also rejects a
changed request, wrong wallet/network, duplicate transfers and stale reports.

**지갑 분석 자료의 검증·집계·근거 연결을 구현했습니다.** 기간이 빠진 요청은
확인을 요청하고, 부분 자료는 답변에서도 부분 결과로 표시합니다.

## Run the examples

```sh
PYTHONPATH=reference python3 -m unittest discover -s reference/tests -v
PYTHONPATH=reference python3 -m ai_baseline.analytics_demo
```

The demo exercises complete and partial reports, payment UNKNOWN, failed
delivery and a wrong-wallet report. Its model selection is scripted and all
records/outcomes are synthetic. No credentials or dependencies are needed.

## What is implemented

| Component | Behavior | File |
| --- | --- | --- |
| Request validation | Require wallet, data network and explicit window before discovery/model calls. Bind task/version/resource to the immutable proposal. | `reference/ai_baseline/analytics.py` |
| Shared access gate | Read only after a matching backend ALLOW + CONFIRMED + COMPLETED observation; check current task access again before returning the answer. | `reference/ai_baseline/workflow.py` |
| Report parser | Reject unknown fields, duplicate JSON keys, wrong types, invalid dates/units, duplicate events and mismatched scope. | `analytics.py:parse_report` |
| Aggregation | Integer arithmetic, grouped by asset and direction. Self-transfers are a separate category. | `analytics.py:summarize` |
| Evidence output | Every asset total lists its exact transfer references. The answer carries report/source references, snapshot time, coverage and synthetic status. | `AnalyticsAnswer`, `AssetTotal` |
| Failure output | Preserve backend reason and next-action tokens without executing them; UNKNOWN cannot trigger content access or repurchase. | `Result` |

Example fixture result: asset A has **4.000000 incoming**, **0.750000 outgoing**
and **0.100000 self-transferred** units. Asset B has **1.000000001 incoming**
units. These remain separate; no portfolio balance or profit is inferred.

## Local input format

This is an internal adapter format named `analytics-reference/v1`. It prepares
validation behavior without selecting the team's public API or merchant DTO.
The complete example is [analytics-report-v1.json](../../reference/fixtures/analytics-report-v1.json).

| Field | Meaning and check |
| --- | --- |
| `resource_ref`, `wallet`, `data_network` | Exact match to the request retained in the proposal. Identifiers are opaque and case-sensitive. |
| `window_start`, `window_end` | Zoned ISO timestamps, start inclusive and end exclusive. The reference caps the window at seven days. |
| `generated_at` | Time the report was prepared. Must not be in the future; compared with the caller-supplied `max_report_age`. |
| `data_as_of` | Historical dataset snapshot time, at or after window start and no later than generation. Complete reports cover through window end. |
| `coverage.complete`, `coverage.pagination_complete` | Booleans. Complete coverage cannot coexist with unfinished pagination or an early snapshot. |
| `is_synthetic` | Required boolean. A synthetic backend observation always keeps the answer synthetic even if the report says otherwise. |
| `source_refs` | 1–20 distinct provenance references; every transfer points to one. No URL is fetched. |
| `transfers` | Up to 500 transfer rows within a 256,000-byte JSON body. An empty list is allowed. |

Each transfer contains `record_id`, `source_ref`, `transaction_ref`, `event_index`,
`timestamp`, `asset_ref`, `decimals`, `amount_base_units`, `from_wallet` and
`to_wallet`. A row must involve the requested wallet and lie inside its window
and snapshot. `(transaction_ref, event_index)` identifies a normalized transfer
event across sources; two events in one transaction remain separate. Repeated
events or record IDs are rejected rather than counted twice.

Amounts are positive ASCII integer strings of at most 78 digits. Decimals are
integers from 0 to 18 and must be consistent for the same asset. These are local
defensive limits, not Solana protocol or token-format decisions. The provider
mapper must define canonical asset IDs, normalized event positions and wallet
ownership mapping, including token accounts, before integration.

## Result behavior

| Situation | Result |
| --- | --- |
| Missing wallet/network/window | `ANALYTICS_SCOPE_REQUIRED`; no discovery or model call |
| Request changed after proposal | `ANALYTICS_SCOPE_MISMATCH`; no content read |
| Valid complete report | `ANALYTICS_SUMMARY`, exact totals and record references |
| Valid partial report | Same structured summary with mandatory partial-coverage limitations |
| Empty partial report | Explicitly says that missing returned transfers do not establish no activity |
| Wrong wallet/resource/network/window | `REPORT_SCOPE_MISMATCH` |
| Repeated normalized transfer | `DUPLICATE_TRANSFER` |
| Old report | `STALE_ANALYTICS_REPORT`, checked after retrieval and again before release |
| Contradictory completeness | `CONTRADICTORY_COVERAGE` |
| DENY / UNKNOWN / paid but undelivered | Existing workflow failure/wait state; no content read or new payment |

`answer_text` is produced from validated fields and deterministic totals. The
machine-readable `totals[].evidence_refs` link each numerical claim to records;
the overall count is tied to the report reference. Consumers should render both
the text and its evidence metadata. Payment and data networks are distinct.
The configured payment network is an observed quote field, not independent
cryptographic settlement proof.

## Integration work to agree

| Owner | Decision needed |
| --- | --- |
| Ria | Map the local context, challenge, outcome and protected-body ports to BE-01. Bind the exact normalized query to merchant requirements and update task version whenever its scope changes. |
| Michael + domain owners | Final report scope, selected provider and usefulness of the demo answer. |
| Ria + Geondong | Approved model/runtime, production data mapper, freshness threshold, callback deadlines and output rendering. |
| Ria + Taeheon | Verified payment/delivery binding, durable purchase identity and recovery semantics. |

The shared access gate trusts the backend adapter's authenticated observation;
it is not an authentication or chain verifier. The local proposal identifier is
not durable payment deduplication. Those boundaries remain integration work.

Tests demonstrate parser and workflow behavior with scripted ports. Live model
robustness, actual provider data and a Devnet paid-response example are still
required for integrated ticket acceptance. No database, public route, provider
SDK or deployment setting is changed by this adapter.

## Planning basis

- [MVP review](https://portfolio4ramp.atlassian.net/wiki/spaces/FTW/pages/7340034)
- [AI workflow and contract proposal](https://portfolio4ramp.atlassian.net/wiki/spaces/FTW/pages/7274500)
- [AI/Solana ticket review](https://portfolio4ramp.atlassian.net/wiki/spaces/FTW/pages/7274523)
- [AI-01 #2](https://github.com/web5five/Floww_Solana_Server/issues/2),
  [AI-02 #6](https://github.com/web5five/Floww_Solana_Server/issues/6),
  [AI-03 #7](https://github.com/web5five/Floww_Solana_Server/issues/7)
