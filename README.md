# Floww_Solana_Server
Backend, AI orchestration, authorization policies and Solana x402 integration.

## Integration service

The `service/` runtime adds signed wallet login, private persistent tasks, exact
Devnet purchase approvals, official x402/SVM transport, RPC transfer reports and
a persistent browser workspace with conversations, separately reviewed plans,
explicit preference memory, scoped mandates, aggregate budget reservations,
owner-only dashboards and paginated task/report history. It builds on the AI reference below; it does
not replace the legacy EVM services or assert a shared team API agreement.

```sh
npm ci --ignore-scripts
npm start
```

Open `http://127.0.0.1:4318`. Defaults bind only to loopback, use a private local
SQLite file and disable payments. See [.env.example](.env.example) for settings;
the process reads environment variables, not an automatically loaded `.env`.
Without a merchant and opt-in test payer, health correctly reports not ready.
The login wallet identifies the owner; an explicitly approved Devnet service
wallet is the payment source.

```sh
npm run check
FLOWW_REQUIRE_POSTGRES_TESTS=true npm test
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=reference python3 -m unittest discover -s reference/tests -v
```

The required PostgreSQL checks start and remove their own isolated cluster using
existing non-root PostgreSQL binaries. Runtime tests use scripted transports and
real loopback HTTP/process/DB behavior; they do not prove external settlement.
Actual model calls, wallet acceptance and cloud deployment remain distinct.

See the [purpose-first experience](docs/production/EXPERIENCE.md),
[hackathon quality gates](docs/production/READINESS.md),
[earlier/current comparison](docs/production/COMPARISON.md),
[workspace guide](docs/production/WORKSPACE.md),
[planner roles](docs/production/PLANNER.md), [budget ledger](docs/production/MANDATES.md),
[API contract](docs/integration/API.md), [payment transport](docs/integration/X402.md),
[report/AI integration](docs/integration/PROVIDER_AI.md),
[deployment setup](docs/integration/DEPLOYMENT.md) and
[verification record](docs/integration/VERIFICATION.md).

## AI baseline reference

[AI-01 workflow and acceptance mapping](docs/ai/AI-01_WORKFLOW.md) documents the
common single-agent purchase proposal and resource-consumption flow. The commands
below use synthetic fixtures and run offline, with no payment, database or
production server integration.

```sh
PYTHONPATH=reference python3 -m unittest discover -s reference/tests -v
PYTHONPATH=reference python3 -m ai_baseline.demo
PYTHONPATH=reference python3 -m ai_baseline.analytics_demo
PYTHONPATH=reference python3 -m ai_baseline.report_demo --format html --output 지갑_분석_예시.html
```

The [wallet analytics adapter](docs/ai/AI_ANALYTICS_ADAPTER.md) adds explicit
wallet/window checks, a bounded report format, exact per-asset transfer totals
and record references. Its complete, partial and failure examples run offline.

[Inspectable report output](docs/ai/AI_REPORT_OUTPUT.md) preserves those amounts,
scope and evidence in Markdown or standalone HTML, with explicit synthetic and
partial-data notices.

The optional [OpenAI Responses adapter](docs/ai/AI_MODEL_ADAPTER.md) connects the
existing selection/evidence ports to a real HTTP model runtime when an explicit
model and server-side key are supplied. Its tests use only a local HTTP server;
no live model or payment execution is claimed.

The [purpose and evidence evaluation suite](docs/ai/AI_EVALUATION.md) uses six
synthetic cases to score response validity separately from relevant candidate
and evidence selection. Inject either scripted ports or an explicitly configured
adapter; the report identifies the input and execution kind.

The [AI reference workflow](.github/workflows/ai-reference.yml) runs the suite
on pull requests with Python 3.11, 3.13 and 3.14, without model credentials.

Python 3.11+; standard library only. Shared interfaces and the selected provider
remain pending in the [review and handoff](docs/ai/AI-01_REVIEW_AND_HANDOFF.md).
Passing these checks does not demonstrate a live model call or Solana x402 E2E.
