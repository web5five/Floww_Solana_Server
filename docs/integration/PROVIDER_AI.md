# Report provider and AI bridge

The new Node service adapts RPC observations into the existing
`analytics-reference/v1` format, then uses the unchanged Python validation and
rendering components. It does not copy the legacy EVM implementation.

## Provider

```js
const reportProvider = createReportProvider({ rpc, clock: Date.now, maxTransactions: 40, totalTimeoutMs: 30_000 });
const report = await reportProvider({
  resourceRef, wallet, windowStart, windowEnd, signal,
});
```

`rpc(method, params, {signal})` returns the JSON-RPC **result**, not its envelope.
The service injects its configured Devnet RPC client; the request supplies no
URL. Dates must be explicit UTC instants, end no later than now, with a maximum
seven-day window. The full `getGenesisHash` result must match the independently
observed Devnet genesis before any wallet data is queried; the shortened CAIP-2
network identifier is not used as a full genesis hash. One confirmed
wallet-account signature page (at most 100;
default 40) is queried, followed by confirmed parsed transactions for successful
in-window signatures. JSON-RPC/transport deadlines and body bounds belong to
the injected transport. A single whole-report deadline (default/maximum 30
seconds) is composed with caller cancellation and passed to every RPC; the
transport must honor that signal. This bounds sequential requests together,
not each request independently. The provider propagates cancellation and emits fixed
diagnostics without the RPC URL, upstream response or exception chain.

The canonical report always has `is_synthetic: false` and `complete: false`:
it is RPC-derived data, but a wallet-account query cannot establish an
exhaustive token-account history. `pagination_complete` describes only this
wallet signature query reaching the start boundary or exhausting its page.
Unknown timestamps, duplicate/malformed signature entries, an unexhausted page,
missing transactions, unsupported instructions and transaction version limits
cannot turn the report into complete wallet coverage.

Counted events come from parsed System transfers and parsed SPL transfer or
transferChecked instructions, including recorded inner instructions. Each
amount remains an exact positive u64 base-unit integer; unsafe JSON numbers
are omitted. The provider never derives gross transfers from balance deltas.
SPL source/destination token accounts become wallet owners only when the
transaction's **pre and post** token metadata agree on owner, mint and decimals.
Token account authority/lifecycle changes or unknown token instructions cause
the transaction's token transfers to be omitted. Newly created or closed token
accounts, transfer fees/extensions and unknown instruction formats may be
omitted. Stable event indexes and original signatures remain attached to every
returned event. Returned amounts describe activity, not balances or profit.

## Python bridge

```js
const ai = createAiBridge({ python: 'python3', timeoutMs: 20_000, model, apiKey });
const proposed = await ai.propose({ context, candidate, request, selectionMode: 'direct_resource' });
const output = await ai.consume({
  context, candidate, request, proposalRef, attemptRef, settlementRef, deliveryRef,
  policy: 'ALLOW', payment: 'CONFIRMED', fulfillment: 'COMPLETED', body,
});
```

Context, candidate and request use the exact snake_case dataclass fields from
`workflow.py` and `analytics.py`; date fields are serialized as timezone-aware
ISO timestamps. The service owns those snapshots. It must re-read owner,
task/mandate version and access after each awaited subprocess before saving or
releasing a result. `currentContext` may explicitly supply a fresh snapshot;
this process does not connect to SQLite or authenticate backend assertions.

`direct_resource` means an explicit user choice of the registered report and
does not invoke a model. `selectionMode: 'model'` uses the existing opt-in
Responses adapter only when both explicit model and server-side API key exist.
The result reports its execution kind. Consumption runs the existing protected
resource gate and `consume_analytics`, preserving DENY, UNKNOWN, undelivered,
scope/freshness and malformed-data behavior. Missing authorization/payment/
delivery states fail closed. Only accepted answers produce `answer`, `html`
and `markdown`; raw merchant bodies are not returned by the bridge.

The Node parent enforces a total subprocess deadline, cancellation and bounded
input/output. The key travels through an explicit child environment, never argv,
and unrelated process environment secrets are excluded. Stderr is drained and
discarded. Fixed error codes replace exception text, malformed output and raw
provider responses. No retry or replacement purchase is performed here.

## Verification

Executed with Node 25.8.1 and Python 3.13.3:

- `node --test test/provider.test.mjs test/ai.test.mjs`: 29 checks passed.
- `PYTHONPATH=reference PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s reference/tests -v`:
  146 checks passed (137 existing and nine stdio-adapter checks).
- `node --check service/provider.mjs` and `node --check service/ai.mjs`: passed.

Provider tests use representative scripted RPC results. Bridge checks execute
real Python subprocesses, including timeout/cancellation and credential-boundary
checks. These checks are not live external-model, Devnet settlement or complete
browser E2E evidence.

Sources: [getSignaturesForAddress](https://solana.com/docs/rpc/http/getsignaturesforaddress),
[getTransaction](https://solana.com/docs/rpc/http/gettransaction), and
[RPC JSON structures](https://solana.com/docs/rpc/json-structures), read November 5.
