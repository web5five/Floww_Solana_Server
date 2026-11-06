# Integration handoff for Michael's five questions

Source: Michael's November5 team message1459 in
[the Hackathon GWDC chat](https://web.telegram.org/a/#-5370381941), read back on
November7. This record answers the implementation questions; it is not a message
sent to the team. The requested final submission date is November9.

| Question | Implemented and verified | Remaining acceptance |
| --- | --- | --- |
| Devnet and x402 | V2 exact SVM challenge, constrained partial signing, settlement observation, delivery and original-proof recovery are implemented. November7 external read-only probes returned HTTP200 for the actual Devnet genesis, a current confirmed blockhash and facilitator support for V2 exact Devnet. | A funded test payer and merchant destination must be configured before an actual settlement/delivery can be demonstrated. |
| Backend setup and interfaces | One Node/Python image, owner-scoped HTTP APIs, persistent conversations/Tasks and verified-TLS managed PostgreSQL are integrated. Configuration and API contracts are linked below. | The public HTTPS origin and exact release SHA must be deployed and checked. Render's single-repository app grant remains pending. |
| Infisical | November6 provisioning saved12 Development settings and compared the re-exported values. November7 browser readback reconfirmed12 masked entries and only the owner's Admin membership. The server uses a dedicated DB role and restricted Responses credential. | Other team members are not yet project users. Add the agreed named users with Development permissions before calling sharing complete; keep DB-admin and payer credentials separate. |
| AI and payment integration | Refinement and planner/critic produce a reviewed plan linked to one Task; quote, explicit approval, execute, reconcile and recover share that Task. Output language/filtering and exact scope corrections have versioned regression coverage. | Version4 actual-model acceptance is in progress; its outcome is recorded in [AI_QUALITY.md](../production/AI_QUALITY.md). Actual funded completion remains separate. |
| First Devnet E2E | Automated integration and failure/recovery checks can run now. RPC and facilitator discovery are reachable. | First external payment acceptance follows the public-origin release and test-payer/merchant setup. No completed-payment date can be asserted before those prerequisites are supplied. |

## Backend handoff

- [API.md](API.md): exact routes, owner/session rules and Task operations.
- [X402.md](X402.md): the SDK boundary, signing constraints and original-proof
  recovery contract.
- [DEPLOYMENT.md](DEPLOYMENT.md), [render.yaml](../../render.yaml) and
  [.env.example](../../.env.example): Node/Python runtime, verified TLS,
  exact-origin configuration, manual release and health probes.
- [AI_QUALITY.md](../production/AI_QUALITY.md): retained model failures,
  current output contract and actual reevaluation evidence.
- [VERIFICATION.md](../production/VERIFICATION.md): engineering and runtime
  evidence, with fixture and external results separated.

Authentication identifies the user; the separately configured service test
wallet pays. This differs from the earlier user-funded EVM TaskAccount design.
The AI cannot select a signer, authorize a payment or enlarge an approved scope.
The implementation is available for Ria to integrate; this record does not claim
that the team has accepted a new shared backend contract.

## First external payment acceptance

1. Release the reviewed SHA to the approved HTTPS origin. Check `/livez`,
   `/readyz`, the public interface and unauthenticated401 guards. Keep the
   origin, sign-in domain and merchant resource URL identical.
2. Configure the agreed public merchant address and test-only payer through
   server-side secrets. Check Devnet SOL/token funding and the exact amount,
   asset and aggregate cap before enabling payments. Keep voice and administrator
   access at their defaults unless separately configured.
3. Use the real wallet sign-in, then create one bounded report request and
   review its exact wallet, period, resource and quote. Give explicit approval
   before one execution; never replace an uncertain attempt by signing again.
4. Retain the source SHA, original Task/proof, confirmed transaction observation,
   exact settlement receipt and delivered report. Reconcile/recover that same
   proof and verify no second charge. Preserve UNKNOWN when confirmation is
   unavailable.

The existing12 Infisical settings cover the initial core setup, not every
optional voice/admin/payment setting. The current Responses credential expires
November13 and does not permit Audio transcription. Neither a green readiness
probe nor the successful read-only Devnet discovery proves wallet funding,
public deployment, settlement, delivery or a complete payment E2E.
