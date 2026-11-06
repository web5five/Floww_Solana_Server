# Earlier Floww and the current hackathon entry

Comparison checked November6 from exact local Git objects. Earlier repository
refs are preserved evidence, not a fresh assertion about remote deployments.
The goal is production-level quality for a hackathon entry. This comparison
does not require an always-on production business or a new EVM implementation.

## Baselines

| Source | Exact reference |
| --- | --- |
| Original submitted Client | `688d14e214dbf0eb728b5e3caa1ad488852da455` |
| Later merged Client | `8c820c270551b82effff06225aa7395322385485` |
| Preserved Server main, including evidence documents | `f729b0efc442514262f0ca108ab444aba841cccd` |
| Earlier independently exercised Server runtime | `e86e3592eeed512d4f41601a1a46108d45472a39` |
| Earlier contract | `d4e6a7d7b7635634b8a59f7c87bba91d3b311f9d` |
| Solana starting checkpoint, PR10 | `1a3f9643cc2e7a77108cb24f60375c081d8a8dc3` |

The earlier Server's `docs/F031_INDEPENDENT_SEPOLIA.md` is present in the
preserved main reference. It records the runtime SHA above and55 independent
public-chain/runtime assertions. The source of that record is a later evidence
commit; the document does not exist in the runtime commit itself.

## Product and authority comparison

| Area | Earlier Floww | Solana starting checkpoint | Quality action |
| --- | --- | --- | --- |
| Entry journey | Fixed pharmacy allow, over-budget and recipient-mismatch scenarios; KO/EN and voice integration | Natural-language intent, clarification, separate planner/critic, scope confirmation and an in-conversation task | Preserve simple delegation; test complete positive, refusal and recovery journeys |
| Supported resource | Pharmacy quote/order/fulfillment simulator | One registered wallet-transfer report, bounded SOL/SPL observations and at most7days | Explain supported questions and coverage; do not imply a general analytics marketplace |
| Login | EVM SIWE/JWT through a Client BFF; optional Magic development path | Phantom Ed25519 challenge/signature and persisted session | Check login/reconnect/owner changes without treating login as payment approval |
| Funds and authority | User-created and funded TaskAccount; contract checks immutable payee/cap and EIP712 approval | Shared server-funded Devnet payer; exact consent and aggregate limits enforced by server/DB | Explain payer/source clearly. These are different trust models |
| Budget | Task mandate version, order reservation, payee and deadline restrictions | Payer/day aggregate reservations; mandate total, per-purchase, count and expiry | Verify refusal before signing and preserve holds for uncertain outcomes |
| Repetition | Single TaskAccount payment | Multiple bounded approved purchases; no autonomous recurring scheduler | Keep exact purchase consent; do not advertise automatic repetition |
| Completion | Exact transfer event plus separate reporter-confirmed simulated fulfillment | Verified payment plus separately validated JSON delivery and grounded answer | An HTTP200, plan, quote or confirmed payment alone is insufficient |
| Recovery | Durable signed operation/nonce, restart and original-hash reconciliation | Durable proof before send, original transaction reconciliation and same-proof delivery recovery | Exercise disconnect/shutdown/restart without a replacement payment |
| Results | Scenario-oriented order/fulfillment screens | Validated transfer totals/evidence, but the starting answer prose is fixed English | Honor supported language and question focus while retaining exact facts |
| Current real evidence | Locally hosted backend, real Kiln and public Sepolia payment/restart checks; pharmacy content simulated | Real model/managed PostgreSQL/HTTP auth/plan-to-task and browser checks | Add current-chain completion evidence; do not relabel old-chain evidence |

## What the earlier evidence proves

The F031 record describes actual public Sepolia transfers, exact amount/event
checks and process restart followed by original-payment reconciliation. It also
separates hosted-frontend/user-operated wallet acceptance and simulated physical
fulfillment. That record is useful as a quality bar; it does not verify the
current Solana payer, x402 settlement, Phantom flow or public demo origin.

The current checkpoint has stronger persisted conversations, scoped preference
memory, separately reviewed plans and aggregate budget accounting. Its real
model/DB/browser checks have not yet established funded Devnet settlement and
delivery. The acceptance ledger keeps those gates explicit.

## This improvement iteration

- Invalidate an explicitly changed wallet/window when its replacement cannot be
  resolved; never silently proceed with the earlier scope.
- Bound public merchant work and duplicate-proof amplification before expensive
  verification/report calls while preserving durable settlement order.
- Separate liveness/readiness/payment capability, and keep financial bookkeeping
  tracked through HTTP disconnect and bounded shutdown.
- Record bounded operational diagnostics without retaining private request data.
- Present the validated answer in the requested supported language/focus, with
  unchanged amounts, source references and partial-coverage limits.

Source review uses Client `src/components/task-execution.tsx`, Server
`TaskService.java`, `TaskAccountService.java` and the F031 evidence document,
Contract `FlowwTaskAccount.sol`, and current `service/{app,policy,x402,mandates,
provider}.mjs` plus `docs/production/VERIFICATION.md`. The current review is
source/evidence comparison, not a new execution of the earlier testnet flow.
