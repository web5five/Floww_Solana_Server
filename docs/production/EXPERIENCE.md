# Purpose-first experience — 2026-11-06

The visual hierarchy and first-visit acceptance criteria are specified in
[DESIGN.md](DESIGN.md). The interaction boundaries below remain required while
the presentation is redesigned.

Geondong asked the controller to reflect Michael's earlier product-management
and user-experience discussions in the integrated workspace. This change applies
that direction to the current Solana-transfer capability. It does not record a
new team-wide design decision or claim that the illustrative shopping/voice
scenarios are implemented.

## Source and interpretation

- [Michael's Solana analytics proposal](https://portfolio4ramp.atlassian.net/wiki/spaces/FTW/pages/4522028): the named wallet/project and authorized scope lead to
  a policy-bound purchase and an evidence-based answer. Exact payee, asset,
  amount, scope and expiry checks precede signing; settlement and delivery are
  separate facts. The controller read the complete November 2 archived page.
- The September 28 discussion at 20:54:50–20:58:43 covers natural-language
  requests, avoiding repeated intermediate approvals, backend structuring,
  accessible result explanations and optional visibility into progress. The
  transcript's speaker attribution is uncertain, and participants differed on
  how much status should be shown. These remarks are not attributed as a
  verbatim statement or final unilateral decision by Michael.
- The October 30 competitive research frames task-context authorization and
  payment-to-answer evidence as Floww's proposed value. It does not make an
  analytics dashboard the product's entire purpose.

Confluence connector access to this site was denied in this run. The archived
originals and reconciled conversation record were used, rather than claiming a
fresh Confluence edit or publishing a new team specification.

## Applied interaction

1. **State the outcome.** The assistant is the initial page. A guest can type a
   local draft; no protected model/task work runs before wallet authentication.
   A completed explicit login continues the unchanged queued request once.
   Changes of authenticated owner still clear all private drafts and results.
2. **Prepare without repeated permission dialogs.** Once the actual refiner has
   complete supported scope, a separate planner/critic runs once as part of that
   request. Missing/unsupported scope and uncertain responses do not trigger
   hidden model retries. Direct wallet/time editing and previous conversations
   are available under disclosure controls.
3. **Review one concrete scope.** A visible exact-plan button requests payment
   conditions. It confirms that plan's hash and scope and creates/links one
   idempotent task; it does not approve a financial operation. Non-financial
   quote preparation follows without sending the user to another page.
4. **Approve exact financial terms.** The mounted task component shows price,
   scope, deadline and visible payee/token summaries with expandable full
   addresses. One explicit financial
   checkbox/button calls the existing approval endpoint and then executes that
   same task with the returned exact approval ID. Existing server checks still
   run at execution/signing; a mandate, memory or model never auto-approves it.
5. **Receive the answer in context.** The same task/result component is mounted
   in the conversation, rather than duplicating payment controls or copying
   results. Results and evidence precede optional execution/receipt details.
6. **Understand a stop.** A short current status states what is known, why the
   flow stopped and the safe next action. UNKNOWN uses original-transaction
   checks, while confirmed-but-undelivered uses the original payment. Progress
   is based on actual states, without fabricated percentages or success.

Token budgets are entered as decimal token amounts and converted with exact
integer arithmetic. Atomic base units remain in the backend contracts and
expandable transaction details. Invalid precision, exponential notation and
values beyond the bounded integer representation are rejected.

Temporal anchoring recognizes a bounded set of explicit rolling-period
expressions, including 하루/이틀/사흘/일주일. It is not a general natural-language
date parser. Multiple periods require clarification unless complete expressions
form a supported explicit replacement. A recognized connector immediately
continuing a named period stays unresolved even when its tail is not another
supported time word; ordinary purpose/style text remains supported.

## Preserved boundaries

- Every new financial execution still requires explicit exact-quote consent.
- Quote expiry, owner/session fences, duplicate prevention and aggregate budget
  reservations remain in the path. Past-owner responses cannot populate a new
  owner's conversation, task controls or draft.
- A failed quote does not lose the confirmed task or imply a payment. Preparing
  a plan or a price is separate from executing a transaction.
- No extra wallet signer, credential grant, microphone permission, public
  exposure, mainnet operation or paid resource is introduced by this UX change.
- Browser acceptance, automated ordering/privacy regressions and exact source
  review are recorded separately from actual funded Devnet settlement.

## Navigation acceptance contract

The six workspace pages and an owned conversation/Task need explicit addresses
and browser Back/Forward support. Conversation request, plan, payment and result
links reveal the corresponding existing content. Their selection cannot change
the factual stage or authorize a side effect.

- Use allowlisted same-document hash routes with opaque UUID identifiers only.
  No request text, wallet, quote, approval, proof or private object belongs in
  the URL, browser history state or persisted draft storage.
- Restoring a route is read-only. A reload, Back/Forward or stage link must not
  create a conversation/Task, call a model, prepare a quote or execute/recover
  a payment. The server must authenticate and authorize every restored record.
- Fresh authenticated bootstrap can restore an owned deep link. Once guest
  status is confirmed, sanitize its private target; login must not silently
  hydrate a target carried across an unknown owner. Owner/session renewal and
  route generations must reject stale responses and stale expiry events.
- Normal page navigation preserves the current user's unsent draft in memory.
  New context, logout and owner changes must not leak former private content.
  A pending financial operation remains bound to its original exact selection.
- Keep the keyboard skip link, meaningful focus and actual progress semantics.
  A requested result stage without a result remains unavailable, not complete.

[MDN's History API documentation](https://developer.mozilla.org/en-US/docs/Web/API/History/pushState)
and [popstate event sequence](https://developer.mozilla.org/en-US/docs/Web/API/Window/popstate_event)
were checked on November7: explicit history writes do not dispatch traversal
events, and traversal can also dispatch a hash event. The implementation must
not apply the same navigation twice. Focus checks follow
[W3C's focus-order guidance](https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html);
this is not a claim of full accessibility conformance.

## Acceptance

The internal browser exercised a newly typed natural-language request through
the actual refiner and automatic planner/critic, then used the exact-plan
action to create one persistent task and request its quote in the conversation.
Reloading reopened the same linked task with the exact original time window.
The provider is not configured: the task stayed `NOT_STARTED`, without a quote,
approval or transaction. This run did not execute a financial operation.

The browser's generated Ed25519 identity completed actual HTTP authentication;
it is not evidence of a user's Phantom-extension acceptance. With no extension,
guest login failed visibly and preserved the request text. Desktop and 390px
mobile views were visually inspected, including long-address wrapping, optional
progress and logout clearing private task/conversation state. The temporary
viewport was reset and the test session logged out. Screenshots and sanitized
readbacks are retained in the local GWDC evidence directory, outside the repo.

Automated browser-client checks execute the shipped scripts in a small DOM
harness with scripted network responses. They verify action ordering, exact
approval binding, failure/retry behavior, stale-owner isolation and scope
editing; they are not a real browser or funded settlement result.
