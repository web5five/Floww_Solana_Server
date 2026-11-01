# Floww_Solana_Server
Backend, AI orchestration, authorization policies and Solana x402 integration.

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
