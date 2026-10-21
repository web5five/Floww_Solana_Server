# Floww_Solana_Server
Backend, AI orchestration, authorization policies and Solana x402 integration.

## AI baseline reference

[AI-01 workflow and acceptance mapping](docs/ai/AI-01_WORKFLOW.md) documents the
common single-agent purchase proposal and resource-consumption flow. The offline
reference under `reference/` uses synthetic fixtures and has no payment, network,
database or production server integration.

```sh
PYTHONPATH=reference python3 -m unittest discover -s reference/tests -v
PYTHONPATH=reference python3 -m ai_baseline.demo
PYTHONPATH=reference python3 -m ai_baseline.analytics_demo
```

The [wallet analytics adapter](docs/ai/AI_ANALYTICS_ADAPTER.md) adds explicit
wallet/window checks, a bounded report format, exact per-asset transfer totals
and record references. Its complete, partial and failure examples run offline.

Python 3.11+; standard library only. Shared interfaces and the selected provider
remain pending in the [review and handoff](docs/ai/AI-01_REVIEW_AND_HANDOFF.md).
Passing these checks does not demonstrate a live model call or Solana x402 E2E.
