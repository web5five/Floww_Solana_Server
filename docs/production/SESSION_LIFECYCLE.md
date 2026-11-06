# Browser departure and authenticated return

## Observed problem and boundary

Native internal-browser acceptance with two generated, genuinely authenticated
test identities reproduced an old-owner draft on a different owner's screen:
A typed an unsent request, left the document, another tab authenticated B, and
Back restored A's textarea under B's current wallet. No request was submitted,
no real user data was used and no model or financial port was called.

The browser created a new document and reported `pageshow.persisted=false`.
This was native form-history restoration, not a demonstrated BFCache leak.
An additional explicitly cache-eligible, loopback-only engineering fixture also
created a new document. Production cache/security headers were not changed.

The [HTML history specification](https://html.spec.whatwg.org/multipage/browsing-the-web.html#history-traversal)
allows restoration of persisted form state without ordinary input/change events.
[Chrome's no-store guidance](https://developer.chrome.com/docs/web-platform/bfcache-ccns)
also distinguishes HTTP caching from document caching and describes conditions
that evict sensitive pages. Neither an input handler nor `no-store` is evidence
that the application has handled every return path.

## Application contract

- Initial/cold entry keeps the private surface unavailable through the initial
  history traversal. It clears unbound native form-history values before
  publishing the current authenticated session. A fresh document cannot prove
  the prior owner of an automatically restored draft and must not attach it to
  the current cookie owner.
- On `pagehide`, invalidate action/read/session generations synchronously,
  abort owned reads and stop capture/playback before any awaited continuation
  can resume. In particular, an old approval cannot continue into execution,
  and an old message cannot continue into planning.
- Keep only owner-bound unsent drafts and exact uncertain-request identities in
  closure memory. Clear private DOM, server snapshots and acknowledgments.
  Never persist these drafts in URLs, history payloads or browser storage.
- A same-document return requires a fresh, fenced `GET /api/session` and fresh
  owned record reads. Only the verified same wallet may recover its quarantined
  drafts. Another owner or guest discards them. Failed verification keeps them
  inaccessible behind explicit recheck. A second departure invalidates the
  first verification attempt.
- Restore no financial, memory-save/mandate or voice acknowledgment, microphone,
  utterance, quote request, model submission, signing, payment or recovery
  operation. The verified owner's conversation-memory preference remains a
  draft. Exact quote budget/expiry drafts may
  be recovered only after the same current Task and quote are read again;
  acknowledgment remains false. Voice text requires a fresh explicit rebase.

## Wallet account-change revocation

Ordinary document departure/restoration issues no mutation. A wallet provider's
actual account-change event separately attempts background session revocation
through `POST /api/auth/logout` with `{expectedWallet}`. The server compares the
owner of the immutable token captured in that HTTP request and revokes only a
matching token. Conditional match, mismatch and guest responses are all204 and
never issue `Set-Cookie`: a delayed old-owner response cannot erase a newer
sign-in cookie. Strict body/origin guards remain unchanged.

The existing explicit manual logout body `{}` still revokes the current token
and clears its cookie. The conditional request is small and may use keepalive;
its eventual response cannot repopulate client state. A transport attempt is
not proof of successful server revocation.

## Verification scope

The release's exact-source tests, native before/after observations and remaining
limits are in [VERIFICATION.md](VERIFICATION.md). Scripted lifecycle events can
exercise pending-action, media and owner races, but cannot establish that a
native document was restored from BFCache. That claim requires observed
`persisted=true` and retained document identity. Cold-return acceptance and
same-document regression evidence remain explicitly separate.
