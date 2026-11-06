import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { getBase58Decoder } from '@solana/kit';
import { createReportProvider, DATA_NETWORK, DEVNET_GENESIS_HASH, ProviderError } from '../service/provider.mjs';

const encoded = (n, size = 32) => getBase58Decoder().decode(new Uint8Array(size).fill(n));
const WALLET = encoded(7), OTHER = encoded(8), SOURCE_ACCOUNT = encoded(9), DEST_ACCOUNT = encoded(10);
const MINT = encoded(11), SIGNATURE = encoded(12, 64);
const SYSTEM = '11111111111111111111111111111111';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const NOW = Date.parse('2026-11-05T12:00:00Z'), TIME = Date.parse('2026-11-05T10:00:00Z') / 1_000;
const SCOPE = { resourceRef: 'urn:floww:report:one', wallet: WALLET,
  windowStart: '2026-11-04T11:00:00Z', windowEnd: '2026-11-05T11:00:00Z' };
const native = (amount = 42) => ({ program: 'system', programId: SYSTEM,
  parsed: { type: 'transfer', info: { source: OTHER, destination: WALLET, lamports: amount } } });
const balance = (accountIndex, owner, mint = MINT, decimals = 6) => ({ accountIndex, owner, mint,
  uiTokenAmount: { amount: '123', decimals, uiAmount: 0.000123 } });
function tx(instructions = [native()]) {
  return { blockTime: TIME, meta: { err: null, innerInstructions: [],
    preTokenBalances: [], postTokenBalances: [] },
    transaction: { signatures: [SIGNATURE], message: {
      accountKeys: [WALLET, OTHER, SOURCE_ACCOUNT, DEST_ACCOUNT], instructions } } };
}
function setup(transaction = tx(), rows = [{ signature: SIGNATURE, blockTime: TIME, err: null }], options = {}) {
  const calls = [];
  const provider = createReportProvider({ clock: () => NOW, ...options,
    rpc: async (method, params) => {
      calls.push({ method, params });
      return method === 'getGenesisHash' ? DEVNET_GENESIS_HASH : method === 'getSignaturesForAddress' ? rows : transaction;
    } });
  return { provider, calls };
}
function tokenTransaction(type = 'transferChecked') {
  const value = tx([{ program: 'spl-token', programId: TOKEN, parsed: { type, info: {
    source: SOURCE_ACCOUNT, destination: DEST_ACCOUNT, mint: MINT,
    amount: '9007199254740993', tokenAmount: { amount: '9007199254740993', decimals: 6 } } } }]);
  value.meta.preTokenBalances = [balance(2, OTHER), balance(3, WALLET)];
  value.meta.postTokenBalances = structuredClone(value.meta.preTokenBalances);
  return value;
}

test('maps parsed native transfer with original signature and explicit partial coverage', async () => {
  const { provider, calls } = setup();
  const result = await provider(SCOPE);
  assert.equal(result.schema_version, 'analytics-reference/v1');
  assert.equal(result.data_network, DATA_NETWORK);
  assert.equal(result.is_synthetic, false);
  assert.deepEqual(result.coverage, { complete: false, pagination_complete: true });
  assert.equal(result.transfers.length, 1);
  assert.equal(result.transfers[0].transaction_ref, SIGNATURE);
  assert.equal(result.transfers[0].amount_base_units, '42');
  assert.equal(result.transfers[0].decimals, 9);
  assert.deepEqual(calls.map(x => x.method), ['getGenesisHash', 'getSignaturesForAddress', 'getTransaction']);
  assert.deepEqual(calls[2].params[1], { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
});
test('large string amounts stay exact, unsafe numeric amounts are omitted', async () => {
  const { provider } = setup(tx([native('9007199254740993'), native(9007199254740993), native('18446744073709551616')]));
  const result = await provider(SCOPE);
  assert.deepEqual(result.transfers.map(x => x.amount_base_units), ['9007199254740993']);
});
test('net balance changes and unknown programs cannot invent transfer events', async () => {
  const value = tx([{ program: 'other', programId: TOKEN, parsed: { type: 'transfer', info: native().parsed.info } }]);
  value.meta.preBalances = [1, 100]; value.meta.postBalances = [99, 2];
  const result = await setup(value).provider(SCOPE);
  assert.deepEqual(result.transfers, []); assert.equal(result.coverage.complete, false);
});
test('parsed inner transfers retain distinct event indexes', async () => {
  const value = tx(); value.meta.innerInstructions = [{ index: 0, instructions: [native(3)] }];
  const result = await setup(value).provider(SCOPE);
  assert.deepEqual(result.transfers.map(x => x.event_index), [0, 1]);
  assert.equal(new Set(result.transfers.map(x => x.record_id)).size, 2);
});
test('SPL checked and plain transfers map transaction-time token-account owners', async () => {
  for (const type of ['transferChecked', 'transfer']) {
    const result = await setup(tokenTransaction(type)).provider(SCOPE);
    assert.equal(result.transfers.length, 1);
    assert.equal(result.transfers[0].from_wallet, OTHER);
    assert.equal(result.transfers[0].to_wallet, WALLET);
    assert.equal(result.transfers[0].asset_ref, MINT);
    assert.equal(result.transfers[0].amount_base_units, '9007199254740993');
  }
});
test('SPL token accounts are not presumed to be wallet owners', async () => {
  const value = tokenTransaction();
  delete value.meta.preTokenBalances[0].owner; delete value.meta.postTokenBalances[0].owner;
  assert.deepEqual((await setup(value).provider(SCOPE)).transfers, []);
});
test('conflicting token ownership across execution omits ambiguous transfers', async () => {
  const value = tokenTransaction(); value.meta.postTokenBalances[0].owner = WALLET;
  assert.deepEqual((await setup(value).provider(SCOPE)).transfers, []);
});
test('one-sided token owner evidence and intra-transaction authority changes are omitted', async () => {
  const missing = tokenTransaction(); missing.meta.preTokenBalances = [];
  assert.deepEqual((await setup(missing).provider(SCOPE)).transfers, []);
  const changed = tokenTransaction();
  changed.transaction.message.instructions.push({ program: 'spl-token', programId: TOKEN,
    parsed: { type: 'setAuthority', info: { account: SOURCE_ACCOUNT, newAuthority: WALLET } } });
  assert.deepEqual((await setup(changed).provider(SCOPE)).transfers, []);
});
test('checked-token mint and decimal substitutions are rejected', async () => {
  for (const change of [{ mint: OTHER }, { tokenAmount: { amount: '4', decimals: 9 } }]) {
    const value = tokenTransaction(); Object.assign(value.transaction.message.instructions[0].parsed.info, change);
    assert.deepEqual((await setup(value).provider(SCOPE)).transfers, []);
  }
});
test('unrelated and failed transfers are not counted', async () => {
  const value = tx(); value.transaction.message.instructions[0].parsed.info.destination = OTHER;
  assert.deepEqual((await setup(value).provider(SCOPE)).transfers, []);
  value.meta.err = { InstructionError: [0, 'failed'] };
  assert.deepEqual((await setup(value).provider(SCOPE)).transfers, []);
});
test('queries only successful in-window signatures, handles unknown block times conservatively', async () => {
  const rows = [{ signature: encoded(13, 64), blockTime: TIME + 86_400, err: null },
    { signature: encoded(14, 64), blockTime: null, err: null },
    { signature: SIGNATURE, blockTime: TIME, err: { failed: true } },
    { signature: encoded(15, 64), blockTime: TIME - 2 * 86_400, err: null }];
  const { provider, calls } = setup(tx(), rows);
  assert.deepEqual((await provider(SCOPE)).transfers, []);
  assert.equal(calls.length, 2);
});
test('full page without crossing start remains pagination-incomplete', async () => {
  const { provider } = setup(tx(), undefined, { maxTransactions: 1 });
  assert.deepEqual((await provider(SCOPE)).coverage, { complete: false, pagination_complete: false });
});
test('null transaction, different signature and duplicate signature never invent evidence', async () => {
  assert.deepEqual((await setup(null).provider(SCOPE)).transfers, []);
  const value = tx(); value.transaction.signatures = [encoded(20, 64)];
  assert.deepEqual((await setup(value).provider(SCOPE)).transfers, []);
  const rows = [{ signature: SIGNATURE, blockTime: TIME, err: null }, { signature: SIGNATURE, blockTime: TIME, err: null }];
  assert.equal((await setup(tx(), rows).provider(SCOPE)).transfers.length, 1);
});
test('RPC failures reveal a fixed diagnostic without the upstream body', async () => {
  const provider = createReportProvider({ clock: () => NOW, rpc: async () => { throw new Error('SECRET rpc URL'); } });
  await assert.rejects(provider(SCOPE), error => error instanceof ProviderError && error.message === 'RPC_UNAVAILABLE'
    && !JSON.stringify(error).includes('SECRET'));
});
test('scope errors and over-seven-day windows make no RPC calls', async () => {
  const { provider, calls } = setup();
  for (const change of [{ wallet: 'bad address' }, { resourceRef: 'not a ref' },
    { windowStart: '2026-10-01T00:00:00Z' }, { windowEnd: '2026-11-06T00:00:00Z' },
    { windowStart: SCOPE.windowEnd }, { windowStart: '2026-02-30T00:00:00Z' }]) {
    await assert.rejects(provider({ ...SCOPE, ...change }), /INVALID_REPORT_SCOPE/);
  }
  assert.equal(calls.length, 0);
});
test('abort before or during an RPC fails closed', async () => {
  const controller = new AbortController(); controller.abort();
  const { provider, calls } = setup();
  await assert.rejects(provider({ ...SCOPE, signal: controller.signal }), /PROVIDER_CANCELLED/);
  assert.equal(calls.length, 0);
  const second = new AbortController();
  const during = createReportProvider({ clock: () => NOW, rpc: async () => { second.abort(); return []; } });
  await assert.rejects(during({ ...SCOPE, signal: second.signal }), /PROVIDER_CANCELLED/);
});
test('invalid provider config and oversized RPC page are rejected', async () => {
  assert.throws(() => createReportProvider({ rpc: null }), /INVALID_PROVIDER_CONFIG/);
  assert.throws(() => createReportProvider({ rpc: async () => [], maxTransactions: 101 }), /INVALID_PROVIDER_CONFIG/);
  assert.throws(() => createReportProvider({ rpc: async () => [], totalTimeoutMs: 30_001 }), /INVALID_PROVIDER_CONFIG/);
  const { provider } = setup(tx(), [1, 2], { maxTransactions: 1 });
  await assert.rejects(provider(SCOPE), /INVALID_RPC_RESPONSE/);
});
test('wrong RPC genesis rejects data before querying wallet history', async () => {
  const calls = [];
  const provider = createReportProvider({ clock: () => NOW, rpc: async method => {
    calls.push(method); return 'another-network-genesis';
  } });
  await assert.rejects(provider(SCOPE), /DATA_NETWORK_MISMATCH/);
  assert.deepEqual(calls, ['getGenesisHash']);
});
test('caller cancellation reaches the active RPC and stops remaining report work', async () => {
  const controller = new AbortController(); let receivedSignal, began;
  const started = new Promise(resolve => { began = resolve; });
  const provider = createReportProvider({ clock: () => NOW, rpc: async (method, params, { signal }) => {
    if (method === 'getGenesisHash') return DEVNET_GENESIS_HASH;
    receivedSignal = signal; began();
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
  } });
  const pending = provider({ ...SCOPE, signal: controller.signal });
  await started; controller.abort();
  await assert.rejects(pending, { code: 'PROVIDER_CANCELLED' });
  assert.equal(receivedSignal.aborted, true);
});
test('one total deadline cancels sequential real HTTP RPC requests', async () => {
  const methods = [], timers = [];
  const server = createServer((req, res) => {
    const chunks = []; req.on('data', part => chunks.push(part));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks)); methods.push(body.method);
      const result = body.method === 'getGenesisHash' ? DEVNET_GENESIS_HASH
        : body.method === 'getSignaturesForAddress' ? [{ signature: SIGNATURE, blockTime: TIME, err: null }] : tx();
      timers.push(setTimeout(() => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ result })); }, 80));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const provider = createReportProvider({ clock: () => NOW, totalTimeoutMs: 210, rpc: async (method, params, { signal }) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}`, { method: 'POST', signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, params }) });
      return (await response.json()).result;
    } });
    const begin = Date.now();
    await assert.rejects(provider(SCOPE), { code: 'PROVIDER_TIMEOUT' });
    assert.ok(methods.length >= 2); assert.ok(Date.now() - begin < 1_000);
  } finally {
    for (const timer of timers) clearTimeout(timer);
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
});
