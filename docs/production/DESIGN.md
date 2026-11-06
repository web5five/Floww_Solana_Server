# Purpose-first product design

## Product direction and source

Michael's [October30 research](https://portfolio4ramp.atlassian.net/wiki/spaces/FTW/pages/8880129)
describes Floww as an authorization and accountability layer for agent purchases.
Wallet analytics demonstrates that product; it is not the entire product identity.
The controller read the archived original authored page. The current Atlassian
connector exposes only a personal site, so this is not a claim of a fresh read
or edit of the team's Confluence site.

The September28 discussion at20:54–20:56 argues for natural conversation,
accessible explanations, backend structuring and optional progress visibility.
Its speaker labels are uncertain. Treat it as a recorded team discussion,
not a verbatim quotation attributed to Michael. The user's current direction
is to carry that accessible, purpose-led experience into the actual product.

## Problem to fix

The preceding screen repeats the opening question in three places, nests a
composer inside a large empty card and gives history, an empty plan and runtime
settings substantial visual weight. Body/helper text is frequently9–12px. That
makes an internally integrated workflow look like a collection of management
panels and weakens the user's understanding of what to do first.

## Experience criteria

| Moment | What the user should see | Required behavior |
| --- | --- | --- |
| First visit | One purpose heading, one polished request composer, a concise support explanation and useful example questions | Typing or choosing an example remains local until explicit authenticated submission; no fabricated prices, history or outcomes |
| Clarification | The user's own words and a focused response | Preserve drafts, wallet/time edits and current identity; do not turn examples into forced categories |
| Plan | Relevant scope and the next useful action in the conversation | Reveal actual planning context; keep advanced fields available without requiring them on entry |
| Consent | What will be purchased, exact price, payer, recipient, token and deadline | Preserve current explicit consent and backend verification; navigation and visual progress cannot authorize payment |
| Waiting or refusal | One clear current state, its reason and a safe next action | Use actual DENY, UNKNOWN and delivery facts; never invent progress percentages or retry a payment implicitly |
| Result | The answer and its limitations first, with accessible evidence and receipt details | Keep the same Task/result component, exact amounts, source text and report downloads |
| Returning | A clear way back to actual conversations and requests | Keep owner isolation and all management views reachable without putting their controls ahead of a new request |

Three starters cover supported transfer-summary, incoming and outgoing questions.
They are optional editable examples. They are not three simulated payment
outcomes and do not create a task, select a paid resource or submit a request.

## Visual direction

The blue team mark is preserved exactly. Blue accents, midnight text and a warm
white canvas form the chosen visual implementation; these colors are not
attributed to Michael. Use a consistent spacing scale, restrained surfaces,
readable14–16px body copy, clear heading hierarchy and coherent line icons.
Avoid repeated empty boxes, decorative statistics, arbitrary glyphs and broad
claims about capabilities that are not implemented.

The request action is primary. Header wallet access, history, settings and
connection diagnostics are secondary. Show one actual current stage; deeper
progress, execution records and operational details remain available on demand.
Scope controls must stay discoverable without dominating the first screen.

After a plan is ready, its review comes before the optional transcript and
revision composer. An actionable planning error puts the same retry control
beside the current status. For an exact linked Task with an actual answer, the
completed status becomes compact and the report precedes receipt/history
details. Refusal and unresolved-payment explanations remain fully visible.

## Acceptance and evidence

- At desktop, tablet and390px phone widths, the opening purpose and editable
  composer/action are clear without searching through management panels. At
  least one starter is visible in the first phone viewport; all three remain
  reachable. No horizontal clipping or inaccessible controls.
- Exercise both KO/EN views, actual conversation/plan states, exact consent,
  DENY, UNKNOWN and a grounded result. Preserve original external/user/model
  text, IDs, addresses, amounts and downloaded bytes.
- Keyboard focus, labels, reading order, reduced-motion behavior and touch
  targets need direct checks. This is not a claim of complete WCAG conformance.
- Capture before/after browser evidence. Scripted display cases demonstrate
  layout and interaction contracts, not real authentication or settlement.
  Actual public deployment and funded Devnet acceptance remain separate gates.

The desired endpoint remains production-level quality for a hackathon entry.
Visual polish alone cannot close the complete journey, voice, deployment or
funded-payment acceptance items in [READINESS.md](READINESS.md).
