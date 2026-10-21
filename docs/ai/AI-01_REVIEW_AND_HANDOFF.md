# AI-01 / AI-02 / AI-03 review and handoff

- Owner: Geondong Kim (`geondongkim`).
- Prepared: 2026-10-18 KST.
- Status: local reference verified; production integration awaiting shared decisions.
- Branch: `feature/ai-01-baseline-reference`.
- Base: `6d8e7f9c0c89803201b5c09b7de84f17e317a74c` (initial server README).
- Owned files: `reference/ai_baseline/`, `reference/tests/`, `reference/.gitignore`,
  `docs/ai/`, and a README entry linking this work.
- Source issues: [AI-01 #2](https://github.com/web5five/Floww_Solana_Server/issues/2),
  [AI-02 #6](https://github.com/web5five/Floww_Solana_Server/issues/6),
  [AI-03 #7](https://github.com/web5five/Floww_Solana_Server/issues/7).

## Change and reason / 변경과 이유

### October 21: bounded analytics preparation

Added explicit scope checks, immutable request binding, strict report validation,
exact transfer aggregation, provenance references and partial-coverage output.
The generic and analytics consumers share one access gate. See the
[adapter guide](AI_ANALYTICS_ADAPTER.md) for executable examples and the compact
integration checklist. Current checks are in [verification.json](verification.json);
the original 35-test record is preserved in
[verification-2026-10-18.json](verification-2026-10-18.json).

KO: 지갑·기간 검증, 분석 자료 검사, 자산별 정확한 집계와 근거 연결을 구현했습니다.
공급자·공통 API 합의가 끝나면 어댑터를 연결할 수 있도록 준비했습니다.

EN: Implements independently testable proposal validation and protected-resource
consumption while the team is choosing its MVP and shared contracts. Model output
can select known candidates/records but cannot rewrite quote terms or issue
payment authority. Uncertain payment and delivery failures cannot become a
successful result.

KO: MVP와 공통 계약 협의가 필요한 동안 독립적으로 진행할 수 있는 제안 검증과
자료 소비 흐름을 구현했습니다. 모델은 제공된 후보·근거를 선택하며, 견적 변경이나
결제 권한 부여를 할 수 없습니다. 결제 미확정과 자료 전달 실패를 성공으로
표현하지 않습니다.

## Decisions needed before integration / 통합 전 협의

| Owner | Focused question | Prepared default for review, not an accepted decision |
| --- | --- | --- |
| Ria | Where is an AI proposal attached relative to Task/Attempt creation? | Use a proposal reference until the backend creates the durable attempt. |
| Ria | Which endpoint/DTO supplies scoped context, fresh versions and proposal submission? | Map the local ports to BE-01; introduce no parallel API namespace. |
| Ria + Taeheon | Which exact x402 requirement/alternative is immutable and how is it bound to approval? | Preserve a backend-owned reference and observed terms; the backend revalidates before signing. |
| Taeheon | Which implementation, Devnet network/asset formats, merchant and verifier/facilitator are usable? | No SDK, address validator, mint, signer or protocol version chosen here. |
| Ria + Taeheon | How does a confirmed delivery reference bind to the actual response and settlement? | Adapter verifies both; no client/model assertion counts as evidence. |
| Ria | Which idempotency scope and UNKNOWN reconciliation endpoint/status contract apply? | Reobserve the original attempt; AI cannot retry or create a replacement payment. |
| Ria + Geondong | Which server runtime/model provider, deadlines and least-data rules are approved? | Keep the offline standard-library reference separate from the production build. |
| Michael | Which MVP/provider and minimum useful answer will the demo use? | Preserve all three synthetic examples; validate synthesis quality after selection. |
| Michael + Ria | Should the older multi-agent P0 role entry be reconciled with AI-01's baseline? | Follow the assigned single-agent baseline; require measured benefit for optional complexity. |
| Sinwoo + Ria | How will proposal/policy/payment/delivery/result states and quoted evidence be rendered? | Keep those states distinct; render returned content as escaped text, not instructions or executable HTML. |

No question above is recorded as an agreement. Authentication, authorization,
policy decisions, signing, public routes, DB schema/migrations and server startup
are not modified by this change. Memory ownership/retention, lesson promotion and
multi-agent/Bayesian experiments remain outside this implementation.

## Verification and evidence / 실제 검증

See [verification.json](verification.json) for the executed commands, environment,
source file hashes and explicit limits. Tests are scripted local contract tests.
The demo labels all examples as synthetic and issues no external requests.

Important tested cases: term/authority injection, unknown candidate, malformed or
duplicate-key model JSON, stale owner/task/mandate/purpose, quote expiry, tool
failure, DENY, UNKNOWN, paid-but-undelivered, wrong result binding, invented
citations and access changes during inference.

Independent human review: **pending**. No teammate approval is inferred from the
issue assignment or from passing tests. Shared issue status/checkboxes are not
changed to complete by this work.

## Provenance, deployment and continuation / 출처·배포·후속 작업

- New reference code and tests were authored for the Solana work with Codex
  assistance at Geondong Kim's request.
- Legacy Floww design boundaries were consulted, especially separate AI proposals,
  deterministic enforcement and fresh context checks. No legacy implementation,
  EVM signing logic, migrations or private conversation exports were copied.
- Backend language/framework, deployment configuration and CI requirements still
  belong to the team's foundation decision. No production dependency was added.
- Removal/rollback is limited to this reference directory, its docs and README
  link. There is no data migration, deployed service or resource to roll back.
- [October 21 AI workflow](https://portfolio4ramp.atlassian.net/wiki/spaces/FTW/pages/7274500)
  and [ticket review](https://portfolio4ramp.atlassian.net/wiki/spaces/FTW/pages/7274523)
  define the current planning basis. Implementation evidence lives in this PR;
  integration decisions remain in the review table above.
- After the shared contract is approved: map ports to the actual backend, connect
  the approved model with bounded deadlines, implement the selected provider's
  adapter, then record separate live model, HTTP402, settlement, resource and UI
  evidence before closing AI-02/03 or the integration issue.
