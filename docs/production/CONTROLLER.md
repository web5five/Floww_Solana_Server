# Production workspace controller — 2026-11-06

Geondong explicitly asked this controller to take all implementation roles and
build a larger production-oriented Floww service. Earlier AI-only and narrow
one-report milestone boundaries do not limit this work. The initial integration
baseline was `a272a4190f0dcfdf1883c88f677b51fde13444b0`. The production-workspace
expansion merged through PR #9 as `418c271f4fa19fb81cdc56cf89fc59ee9902bfaa`.
The `feature/goal-first-experience` follow-up applies Geondong's request to
reflect the earlier product/UX discussions. See [EXPERIENCE.md](EXPERIENCE.md)
for source attribution, implemented behavior and acceptance boundaries.

## Product outcome

One authenticated workspace connects conversational intent, explicit plans,
owner-scoped memory, budgeted mandates, exact purchase approval, payment and
delivery recovery, grounded reports and execution/audit history. The interface
must support continued use with many tasks and large reports, retries and
concurrent requests. Observed amounts and outcomes come from persisted state.

Production-oriented implementation is not a claim of production acceptance.
Devnet remains the execution network. Mainnet spending, paid upgrades, signing
authority expansion, repository app grants and public exposure still require
their applicable authorization. The pending Render GitHub App question remains
pending; it does not block implementation. No team messages or submission work.

## Work ownership

| Owner | Files and responsibility |
| --- | --- |
| Controller | New workspace repository/routes and browser workspace; config/main wiring; source integration, independent acceptance and release record |
| Backend worker | app.mjs, policy.mjs, store.mjs, postgres-store.mjs; their tests; idempotent task creation, bounded summary pages, archive lifecycle, request tracing/concurrency hooks |
| AI worker | New planner.mjs, new bounded Python workspace adapter and tests; real intent refinement/planner/critic ports and strict response validation |
| Payment worker | New mandates.mjs and tests; catalog, owner-scoped mandates, atomic aggregate reservation ledger and immutable payment observations |

Workers do not change refs, push/merge/deploy, read credentials, touch the live
database or send messages. Root owns those integration decisions. File ownership
is exclusive until a handoff; source changes require another reviewer. Existing
payment/session invariants and all baseline tests must remain in the path.

## Delivery order

1. Fix task-list payload growth and retry duplication; freeze extension ports.
2. Implement persistent conversations/memories, bounded model role execution,
   and registered catalog/mandate/aggregate-budget services in parallel.
3. Integrate the workspace APIs and exact approval/signing hooks. Model output
   and remembered preferences never grant financial authority.
4. Build dashboard, task workspace, conversation/plan, memory, budget and
   activity views with real empty/loading/error/recovery states and responsive
   keyboard-accessible navigation.
5. Independently review negative paths, cross-owner access, concurrency,
   restarts, actual managed-DB behavior and browser flows. Record local/live
   evidence separately; do not call unavailable wallet/payment tests passed.
6. Prepare reviewed source/CI/release evidence; apply approved cloud grants and
   publish only after the deployment is concrete and reviewable.

## Resource bounds

Disk headroom is approximately 1.6 GiB at this start. Reuse current Node/Python
and dependencies; no local Docker images, framework scaffolding or duplicate
dependency caches. Runtime concurrency, request/body sizes, model turns/tokens,
list pages and database pools must be bounded. Remote persistent state is
PostgreSQL with verified TLS; local SQLite remains a development adapter.
