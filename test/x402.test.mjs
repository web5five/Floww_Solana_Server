// Real SDK construction and loopback HTTP; facilitator/RPC outcomes are scripted.
// These tests are not evidence of external Solana settlement.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import express from 'express';
import {
  createKeyPairSignerFromBytes, getBase58Decoder, getBase64EncodedWireTransaction,
  getSignatureFromTransaction, getTransactionDecoder,
} from '@solana/kit';
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentSignatureHeader } from '@x402/core/http';
import { x402Client } from '@x402/core/client';
import { TOKEN_PROGRAM_ADDRESS } from '@x402/svm';
import { ExactSvmScheme as ExactSvmClient } from '@x402/svm/exact/client';
import { createGateway, mountMerchant, DEVNET } from '../service/x402.mjs';
import { createApp } from '../service/app.mjs';
import { createLifecycle, createShutdown } from '../service/lifecycle.mjs';
const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function until(check) {
  const deadline = Date.now() + 2000;
  while (!check() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 1));
  assert.ok(check(), 'controlled merchant boundary was not reached');
}

function key() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const seed = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32);
  const rawPublic = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  return { bytes: Buffer.concat([seed, rawPublic]), address: getBase58Decoder().decode(rawPublic) };
}

async function listen(app, t) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return { origin: `http://127.0.0.1:${server.address().port}`, server };
}

async function environment(t, opts = {}) {
  const payer = key(), feePayer = key(), merchant = key(), mint = key(), blockhash = key();
  const feeSigner = await createKeyPairSignerFromBytes(feePayer.bytes);
  const chain = new Map();
  const counts = { settle: 0, verify: 0, reports: 0, claims: 0, receiptReads: 0, receiptWrites: 0, rpc: [] };
  const reportEntered = deferred(), reportAborted = deferred(), settleEntered = deferred(), settlementCompleted = deferred();
  const claimEntered = deferred(), pendingPutEntered = deferred();
  const settledPutEntered = deferred(), settledPutCompleted = deferred(), storeClosed = deferred();
  const storeState = { closed: false, closes: 0 };
  const mintBytes = Buffer.alloc(82);
  mintBytes.writeBigUInt64LE(10_000_000_000n, 36);
  mintBytes[44] = 6;
  mintBytes[45] = 1;
  let genesis = DEVNET_GENESIS, decimals = 6;
  const rpc = async (method, params) => {
    counts.rpc.push(method);
    if (method === 'getGenesisHash') return genesis;
    if (method === 'getAccountInfo') return {
      context: { slot: 1 }, value: { data: params[1].encoding === 'jsonParsed' ?
        { parsed: { info: { decimals } } } : [mintBytes.toString('base64'), 'base64'],
      lamports: 1_461_600, owner: TOKEN_PROGRAM_ADDRESS, executable: false, space: 82 },
    };
    if (method === 'getLatestBlockhash') return { context: { slot: 1 }, value: {
      blockhash: blockhash.address, lastValidBlockHeight: 1_000_000,
    } };
    if (method === 'getTransaction') return chain.get(params[0]) ?? null;
    if (method === 'getSignatureStatuses') return { value: params[0].map((signature) => chain.has(signature) ?
      { err: null, slot: 2, confirmationStatus: 'confirmed' } : null) };
    if (method === 'getSignaturesForAddress') return [...chain.keys()].map((signature) => ({ signature }));
    throw new Error('Unexpected scripted RPC method');
  };
  const rpcApp = express();
  rpcApp.use(express.json());
  rpcApp.post('/', async (req, res) => {
    if (opts.sdkRpcDelay && req.body.method === 'getLatestBlockhash') {
      await new Promise((resolve) => setTimeout(resolve, opts.sdkRpcDelay));
    }
    res.json({ jsonrpc: '2.0', id: req.body.id, result: await rpc(req.body.method, req.body.params) });
  });
  const { origin: rpcOrigin } = await listen(rpcApp, t);
  const facilitator = {
    async getSupported() { return { kinds: [{ x402Version: 2, scheme: 'exact', network: DEVNET,
      extra: { feePayer: feePayer.address, transactionVersions: [0] } }], extensions: [], signers: { 'solana:*': [feePayer.address] } }; },
    async verify() { counts.verify++; return { isValid: opts.verify !== false, payer: payer.address }; },
    async settle(payload) {
      counts.settle++;
      settleEntered.resolve();
      if (opts.settlementGate) await opts.settlementGate.promise;
      const tx = getTransactionDecoder().decode(Buffer.from(payload.payload.transaction, 'base64'));
      const signatures = await feeSigner.signTransactions([tx]);
      const signedTx = { ...tx, signatures: { ...tx.signatures, ...signatures[0] } };
      const signature = getSignatureFromTransaction(signedTx);
      const wire = getBase64EncodedWireTransaction(signedTx);
      chain.set(signature, { slot: 2, meta: { err: opts.chainFailure ? { InstructionError: [2, 'Custom'] } : null }, transaction: [wire, 'base64'] });
      settlementCompleted.resolve();
      if (opts.lostReceipt) throw new Error('Scripted lost receipt after settlement');
      return { success: true, network: DEVNET, transaction: signature, payer: payer.address, amount: '1000' };
    },
  };
  rpcApp.get('/facilitator/supported', async (req, res) => res.json(await facilitator.getSupported()));
  rpcApp.post('/facilitator/verify', async (req, res) => {
    assert.equal(req.body.x402Version, 2);
    res.json(await facilitator.verify(req.body.paymentPayload, req.body.paymentRequirements));
  });
  rpcApp.post('/facilitator/settle', async (req, res) => {
    assert.equal(req.body.x402Version, 2);
    res.json(await facilitator.settle(req.body.paymentPayload, req.body.paymentRequirements));
  });
  const app = express();
  const { origin, server } = await listen(app, t);
  const config = { network: DEVNET, rpcUrl: rpcOrigin, facilitatorUrl: `${rpcOrigin}/facilitator`,
    origin, merchantOrigin: origin, merchantPayTo: merchant.address, asset: mint.address,
    assetDecimals: 6, amountAtomic: '1000', paymentEnabled: true,
    payerPrivateKey: payer.bytes.toString('base64'), requestTimeoutMs: 2000,
    maxConcurrentOperations: opts.merchantLimit ?? 4 };
  const records = new Map();
  const receiptStore = {
    get(key) { assert.equal(storeState.closed, false); counts.receiptReads++; return records.get(key); },
    async put(key, value) {
      assert.equal(storeState.closed, false); counts.receiptWrites++;
      if (opts.pendingPutGate && value.status === 'PENDING') {
        pendingPutEntered.resolve();
        await opts.pendingPutGate.promise;
      }
      if (value.status === 'SETTLED') {
        settledPutEntered.resolve();
        if (opts.settledPutGate) await opts.settledPutGate.promise;
      }
      assert.equal(storeState.closed, false, 'receipt persistence must retain its store after HTTP close');
      records.set(key, structuredClone(value));
      if (value.status === 'SETTLED') settledPutCompleted.resolve();
    },
    async claim(key) {
      assert.equal(storeState.closed, false); counts.claims++;
      if (opts.claimGate) { claimEntered.resolve(); await opts.claimGate.promise; }
      assert.equal(storeState.closed, false, 'an unfinished claim must retain its store after HTTP close');
      if (records.has(key)) return false;
      records.set(key, { status: 'PENDING' }); return true;
    },
  };
  const reportProvider = async ({ resourceRef, wallet, signal }) => {
    counts.reports++;
    if (opts.claimGate || opts.pendingPutGate) signal.addEventListener('abort', () => reportAborted.resolve(), { once: true });
    if (opts.reportGate) {
      signal.addEventListener('abort', () => reportAborted.resolve(), { once: true });
      if (counts.reports >= (opts.reportTarget ?? 1)) reportEntered.resolve();
      // Deliberately ignore cancellation until released, to prove the merchant
      // cannot start settlement when a late report eventually completes.
      await opts.reportGate.promise;
    }
    if (opts.providerFailure) throw new Error('Scripted provider unavailable');
    return { schema_version: 'analytics-reference/v1', resource_ref: resourceRef, wallet, transfers: [] };
  };
  const gateway = createGateway(config, { rpc });
  const lifecycle = opts.lifecycle ? createLifecycle({ probe: async () => ({ databaseReady: true, ledgerReady: true }) }) : undefined;
  const mount = (target, context) => mountMerchant(target, { ...context, rpc, facilitator: opts.httpFacilitator ? undefined : facilitator });
  if (lifecycle) app.use(createApp({ config, store: { clock: Date.now, receipts: receiptStore }, gateway, reportProvider, lifecycle, mountMerchant: mount,
    adapterStatus: { workspaceAdapterReady: true, reportAdapterReady: true } }));
  else mount(app, { config, receiptStore, reportProvider });
  const store = { close() { storeState.closed = true; storeState.closes++; storeClosed.resolve(); } };
  const url = `${origin}/merchant/reports/purchase-1?wallet=${payer.address}&start=2026-11-01T00%3A00%3A00.000Z&end=2026-11-02T00%3A00%3A00.000Z`;
  return { app, server, config, url, gateway, counts, chain, records, payer, rpc, facilitator, lifecycle, store, storeState, storeClosed,
    reportEntered, reportAborted, settleEntered, settlementCompleted, claimEntered, pendingPutEntered,
    settledPutEntered, settledPutCompleted,
    setGenesis(value) { genesis = value; }, setDecimals(value) { decimals = value; } };
}

test('real SDK 402 -> partial signing -> scripted settlement -> bound resource and cached recovery', async (t) => {
  const e = await environment(t);
  const quoted = await e.gateway.quote(e.url);
  assert.equal(quoted.paymentRequired.x402Version, 2);
  assert.equal(quoted.requirements.network, DEVNET);
  assert.equal(quoted.requirements.amount, '1000');
  assert.equal(quoted.requirements.extra.memo, createHash('sha256').update(e.url).digest('base64url'));
  assert.equal(Buffer.byteLength(quoted.requirements.extra.memo), 43);
  let checked = 0;
  const signed = await e.gateway.sign(quoted, { beforeSign: async () => { checked++; } });
  assert.equal(checked, 1);
  assert.equal(signed.payer, e.payer.address);
  assert.equal(signed.signature, null, 'fee payer has not signed, so there is no canonical chain signature yet');
  assert.match(signed.messageHash, /^[a-f0-9]{64}$/);
  const result = await e.gateway.redeem(e.url, signed, quoted);
  assert.equal(result.payment, 'CONFIRMED');
  assert.equal(result.delivery, 'COMPLETED');
  assert.equal(JSON.parse(result.body).resource_ref, 'urn:floww:report:purchase-1');
  assert.equal(e.counts.settle, 1);
  const recovered = await e.gateway.redeem(e.url, signed, quoted);
  assert.equal(recovered.payment, 'CONFIRMED');
  assert.equal(recovered.body, result.body);
  assert.equal(e.counts.settle, 1);
});

test('old hex memo proofs can recover an existing receipt but cannot start payment', async (t) => {
  const e = await environment(t);
  const current = await e.gateway.quote(e.url);
  const requirements = { ...current.requirements, extra: { ...current.requirements.extra,
    memo: 'floww:' + createHash('sha256').update(e.url).digest('hex') } };
  const paymentRequired = { ...current.paymentRequired, accepts: [requirements] };
  const quoted = { ...current, requirements, paymentRequired };
  await assert.rejects(e.gateway.sign(quoted, { beforeSign() { assert.fail('legacy signing must stop'); } }),
    { code: 'UNAPPROVED_PAYMENT_TERMS' });

  const signer = await createKeyPairSignerFromBytes(e.payer.bytes);
  const legacyClient = new x402Client().register(DEVNET,
    new ExactSvmClient(signer, { rpcUrl: e.config.rpcUrl, transactionVersions: [0] }));
  legacyClient.setSpendControls({ maxAmountPerPayment: false, allowedAssets: [
    { network: DEVNET, asset: e.config.asset, maxAmountPerPayment: '1000' },
  ] });
  const payload = await legacyClient.createPaymentPayload(paymentRequired);
  const paymentHeader = encodePaymentSignatureHeader(payload);
  const wire = getTransactionDecoder().decode(Buffer.from(payload.payload.transaction, 'base64'));
  const messageHash = createHash('sha256').update(wire.messageBytes).digest('hex');
  const signed = { paymentHeader, messageHash, resourceUrl: e.url, payer: e.payer.address, signature: null };
  const refused = await fetch(e.url, { headers: { 'payment-signature': paymentHeader } });
  assert.equal(refused.status, 400);
  assert.equal(e.counts.verify, 0);
  assert.equal(e.counts.settle, 0);
  assert.equal(e.counts.claims, 0);

  const response = await e.facilitator.settle(payload);
  const body = JSON.stringify({ resource_ref: 'urn:floww:report:purchase-1' });
  const key = createHash('sha256').update(e.url + '\n' + messageHash).digest('hex');
  e.records.set(key, { status: 'SETTLED', resourceUrl: e.url, messageHash, payer: e.payer.address, response, body });
  const recovered = await e.gateway.redeem(e.url, signed, quoted);
  assert.equal(recovered.payment, 'CONFIRMED');
  assert.equal(recovered.delivery, 'COMPLETED');
  assert.equal(recovered.body, body);
  assert.equal(e.counts.settle, 1);
  assert.equal(e.counts.reports, 0);
});

test('equivalent concurrent proof is rejected before duplicate facilitator or report work, then cached recovery succeeds', async (t) => {
  const gate = deferred(), e = await environment(t, { reportGate: gate });
  const quote = await e.gateway.quote(e.url);
  const signed = await e.gateway.sign(quote, { beforeSign: async () => {} });
  const first = fetch(e.url, { headers: { 'payment-signature': signed.paymentHeader } });
  await e.reportEntered.promise;
  const payload = decodePaymentSignatureHeader(signed.paymentHeader);
  const encoded = encodePaymentSignatureHeader(Object.fromEntries(Object.entries(payload).reverse()));
  assert.notEqual(encoded, signed.paymentHeader, 'different JSON encoding still contains the identical signed message');
  const duplicate = await fetch(e.url, { headers: { 'payment-signature': encoded } });
  assert.equal(duplicate.status, 429);
  assert.equal(duplicate.headers.get('retry-after'), '1');
  assert.deepEqual(await duplicate.json(), { reasonCode: 'MERCHANT_BUSY' });
  assert.equal(e.counts.verify, 1); assert.equal(e.counts.reports, 1); assert.equal(e.counts.settle, 0);
  gate.resolve();
  const completed = await first;
  assert.equal(completed.status, 200);
  const body = await completed.text();
  const replay = await fetch(e.url, { headers: { 'payment-signature': signed.paymentHeader } });
  assert.equal(replay.status, 200); assert.equal(await replay.text(), body);
  assert.equal(e.counts.verify, 1); assert.equal(e.counts.reports, 1); assert.equal(e.counts.settle, 1);
});

test('merchant global admission bounds distinct proofs and resumes after active responses complete', async (t) => {
  const gate = deferred(), e = await environment(t, { reportGate: gate, reportTarget: 2, merchantLimit: 2 });
  const payments = [];
  for (let index = 1; index <= 3; index++) {
    const url = e.url.replace('purchase-1', 'purchase-' + index);
    const quote = await e.gateway.quote(url);
    payments.push({ url, signed: await e.gateway.sign(quote, { beforeSign: async () => {} }) });
  }
  const pending = payments.slice(0, 2).map(({ url, signed }) => fetch(url, { headers: { 'payment-signature': signed.paymentHeader } }));
  await e.reportEntered.promise;
  const { url, signed } = payments[2];
  const rejected = await Promise.all(Array.from({ length: 12 }, () => fetch(url, { headers: { 'payment-signature': signed.paymentHeader } })));
  for (const response of rejected) {
    assert.equal(response.status, 429); assert.equal(response.headers.get('retry-after'), '1');
    assert.deepEqual(await response.json(), { reasonCode: 'MERCHANT_BUSY' });
  }
  assert.equal(e.counts.verify, 2); assert.equal(e.counts.reports, 2); assert.equal(e.counts.settle, 0);
  gate.resolve();
  for (const response of await Promise.all(pending)) { assert.equal(response.status, 200); await response.text(); }
  const accepted = await fetch(url, { headers: { 'payment-signature': signed.paymentHeader } });
  assert.equal(accepted.status, 200); await accepted.text();
  assert.equal(e.counts.verify, 3); assert.equal(e.counts.reports, 3); assert.equal(e.counts.settle, 3);
});

test('malformed proof and provider failure release temporary admission without poisoning durable proof ownership', async (t) => {
  const options = { providerFailure: true, merchantLimit: 1 }, e = await environment(t, options);
  const malformed = await fetch(e.url, { headers: { 'payment-signature': 'invalid-proof' } });
  assert.equal(malformed.status, 400); assert.deepEqual(await malformed.json(), { reasonCode: 'INVALID_PAYMENT_PROOF' });
  assert.equal(e.counts.verify, 0); assert.equal(e.records.size, 0);
  const quote = await e.gateway.quote(e.url);
  const signed = await e.gateway.sign(quote, { beforeSign: async () => {} });
  const failed = await fetch(e.url, { headers: { 'payment-signature': signed.paymentHeader } });
  assert.equal(failed.status, 503); await failed.json();
  assert.equal(e.records.size, 0); assert.equal(e.counts.settle, 0);
  options.providerFailure = false;
  const retried = await fetch(e.url, { headers: { 'payment-signature': signed.paymentHeader } });
  assert.equal(retried.status, 200); await retried.text();
  assert.equal(e.counts.verify, 2); assert.equal(e.counts.reports, 2); assert.equal(e.counts.settle, 1);
});

test('rejected facilitator verification cannot poison a durable proof claim or start report work', async (t) => {
  const options = { verify: false, httpFacilitator: true }, e = await environment(t, options);
  const quote = await e.gateway.quote(e.url);
  let signs = 0;
  const signed = await e.gateway.sign(quote, { beforeSign: async () => { signs++; } });
  const rejected = await fetch(e.url, { headers: { 'payment-signature': signed.paymentHeader } });
  assert.equal(rejected.status, 402); assert.deepEqual(await rejected.json(), { reasonCode: 'PAYMENT_REJECTED' });
  assert.equal(e.records.size, 0); assert.equal(e.counts.claims, 0); assert.equal(e.counts.receiptWrites, 0);
  assert.equal(e.counts.reports, 0); assert.equal(e.counts.settle, 0);
  options.verify = true;
  const retried = await fetch(e.url, { headers: { 'payment-signature': signed.paymentHeader } });
  assert.equal(retried.status, 200); await retried.text();
  assert.equal(signs, 1); assert.equal(e.counts.verify, 2); assert.equal(e.counts.reports, 1);
  assert.equal(e.counts.claims, 1); assert.equal(e.counts.settle, 1);
});

test('drain rejects actual SDK merchant GET and HEAD requests before verification, receipt reads or provider work', async (t) => {
  const e = await environment(t, { lifecycle: true });
  const quote = await e.gateway.quote(e.url);
  const signed = await e.gateway.sign(quote, { beforeSign: async () => {} });
  const rpcCalls = e.counts.rpc.length, receiptReads = e.counts.receiptReads;
  e.lifecycle.beginDrain();
  for (const [url, method, header] of [[e.url, 'GET'], [e.url, 'GET', signed.paymentHeader],
    [e.url.replace('/merchant/', '/MeRcHaNt/'), 'GET', signed.paymentHeader], [e.url, 'HEAD', signed.paymentHeader]]) {
    const denied = await fetch(url, { method, headers: header ? { 'payment-signature': header } : {} });
    assert.equal(denied.status, 503); assert.equal(denied.headers.get('retry-after'), '1');
    if (method !== 'HEAD') assert.equal((await denied.json()).error.code, 'SERVICE_DRAINING');
    else assert.equal(await denied.text(), '');
  }
  assert.equal(e.counts.verify, 0); assert.equal(e.counts.reports, 0); assert.equal(e.counts.settle, 0);
  assert.equal(e.counts.claims, 0); assert.equal(e.counts.receiptWrites, 0); assert.equal(e.records.size, 0);
  assert.equal(e.counts.rpc.length, rpcCalls); assert.equal(e.counts.receiptReads, receiptReads);
  assert.deepEqual(e.lifecycle.counts(), { requests: 0, work: 0 });
});

test('readiness exposes configured public payer while payment opt-in remains disabled', async (t) => {
  const e = await environment(t);
  const gateway = createGateway({ ...e.config, paymentEnabled: false });
  const ready = await gateway.readiness();
  assert.equal(ready.ready, false);
  assert.equal(ready.payer, e.payer.address);
  const quote = await e.gateway.quote(e.url);
  await assert.rejects(gateway.sign(quote, { beforeSign: async () => {} }), { code: 'SIGNING_NOT_READY' });
});

test('mainnet and unregistered resource URLs are refused before network or signer calls', async (t) => {
  const e = await environment(t);
  await assert.rejects(createGateway({ ...e.config, network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' }).quote(e.url), { code: 'DEVNET_ONLY' });
  await assert.rejects(e.gateway.quote('https://example.com/merchant/reports/purchase-1?wallet=x'), { code: 'UNAPPROVED_RESOURCE' });
  await assert.rejects(e.gateway.quote(e.url.replace('purchase-1', '../secrets')), { code: 'UNAPPROVED_RESOURCE' });
  assert.equal(e.counts.settle, 0);
});

test('changed quote amount, resource, mint and expiry shape fail before final signing callback', async (t) => {
  const e = await environment(t);
  const quote = await e.gateway.quote(e.url);
  let checked = 0;
  for (const [field, value] of [['amount', '1001'], ['asset', key().address], ['network', 'solana:mainnet'], ['payTo', key().address], ['maxTimeoutSeconds', 999]]) {
    const changed = structuredClone(quote);
    changed.requirements[field] = value;
    await assert.rejects(e.gateway.sign(changed, { beforeSign: async () => { checked++; } }));
  }
  const changed = structuredClone(quote);
  changed.paymentRequired.resource.url = e.url.replace('purchase-1', 'purchase-2');
  await assert.rejects(e.gateway.sign(changed, { beforeSign: async () => { checked++; } }));
  assert.equal(checked, 0);
  assert.equal(e.counts.settle, 0);
});

test('RPC genesis and mint decimals are verified before any signer callback', async (t) => {
  const e = await environment(t);
  const quote = await e.gateway.quote(e.url);
  let checked = 0;
  e.setGenesis('different-chain');
  await assert.rejects(e.gateway.sign(quote, { beforeSign: async () => { checked++; } }), { code: 'RPC_NETWORK_MISMATCH' });
  e.setGenesis(DEVNET_GENESIS);
  e.setDecimals(9);
  await assert.rejects(e.gateway.sign(quote, { beforeSign: async () => { checked++; } }), { code: 'ASSET_DECIMALS_MISMATCH' });
  assert.equal(checked, 0);
});

test('approval revoked during RPC preparation prevents actual signing', async (t) => {
  const e = await environment(t);
  const quote = await e.gateway.quote(e.url);
  await assert.rejects(e.gateway.sign(quote, { beforeSign: async () => { throw new Error('revoked'); } }), { code: 'SIGNING_UNAVAILABLE' });
  assert.equal(e.counts.settle, 0);
});

test('proof cannot be replayed for another resource or mutated transfer tuple', async (t) => {
  const e = await environment(t);
  const quote = await e.gateway.quote(e.url);
  const signed = await e.gateway.sign(quote, { beforeSign: async () => {} });
  const payload = decodePaymentSignatureHeader(signed.paymentHeader);
  payload.resource.url = e.url.replace('purchase-1', 'purchase-2');
  const response = await fetch(payload.resource.url, { headers: { 'payment-signature': encodePaymentSignatureHeader(payload) } });
  assert.equal(response.status, 400);
  assert.equal(e.counts.settle, 0);
});

test('lost facilitator receipt preserves UNKNOWN until identical chain message is reobserved, without second settlement', async (t) => {
  const e = await environment(t, { lostReceipt: true });
  const quote = await e.gateway.quote(e.url);
  const signed = await e.gateway.sign(quote, { beforeSign: async () => {} });
  const first = await e.gateway.redeem(e.url, signed, quote);
  assert.equal(first.payment, 'CONFIRMED', 'chain observation is independent of HTTP receipt');
  assert.equal(first.delivery, 'FAILED');
  assert.equal(e.counts.settle, 1);
  const next = await e.gateway.redeem(e.url, signed, quote);
  assert.equal(next.payment, 'CONFIRMED');
  assert.equal(next.delivery, 'COMPLETED');
  assert.equal(e.counts.settle, 1);
});

test('failed on-chain transaction is not a confirmed purchase', async (t) => {
  const e = await environment(t, { chainFailure: true });
  const quote = await e.gateway.quote(e.url);
  const signed = await e.gateway.sign(quote, { beforeSign: async () => {} });
  const result = await e.gateway.redeem(e.url, signed, quote);
  assert.equal(result.payment, 'FAILED');
  assert.equal(result.delivery, 'FAILED');
});

test('provider failure does not settle payment or return invented content', async (t) => {
  const e = await environment(t, { providerFailure: true });
  const quote = await e.gateway.quote(e.url);
  const signed = await e.gateway.sign(quote, { beforeSign: async () => {} });
  const result = await e.gateway.redeem(e.url, signed, quote);
  assert.equal(result.payment, 'UNKNOWN');
  assert.equal(result.delivery, 'FAILED');
  assert.equal(result.body, undefined);
  assert.equal(e.counts.settle, 0);
});

test('parallel identical proof requests settle only once', async (t) => {
  const e = await environment(t);
  const quote = await e.gateway.quote(e.url);
  const signed = await e.gateway.sign(quote, { beforeSign: async () => {} });
  const results = await Promise.all([e.gateway.redeem(e.url, signed, quote), e.gateway.redeem(e.url, signed, quote)]);
  assert.equal(e.counts.settle, 1);
  assert.ok(results.some((result) => result.delivery === 'COMPLETED'));
});

test('quote redirects are not followed', async (t) => {
  const e = await environment(t);
  let called = 0;
  const server = express();
  server.get('/merchant/reports/:id', (req, res) => { called++; res.redirect('https://example.com/'); });
  const { origin } = await listen(server, t);
  const gateway = createGateway({ ...e.config, merchantOrigin: origin });
  await assert.rejects(gateway.quote(e.url.replace(e.config.merchantOrigin, origin)), { code: 'QUOTE_UNAVAILABLE' });
  assert.equal(called, 1);
});

test('malformed challenge and extra payment alternatives fail closed', async (t) => {
  const e = await environment(t);
  const quoted = await e.gateway.quote(e.url);
  const changed = structuredClone(quoted.paymentRequired);
  changed.accepts.push(structuredClone(changed.accepts[0]));
  const gateway = createGateway(e.config, { fetch: async () => new Response('{}', {
    status: 402, headers: { 'payment-required': encodePaymentRequiredHeader(changed) },
  }) });
  await assert.rejects(gateway.quote(e.url), { code: 'INVALID_PAYMENT_CHALLENGE' });
});

test('same signature metadata without bound transaction bytes is not confirmation', async (t) => {
  const e = await environment(t);
  const quote = await e.gateway.quote(e.url);
  const signed = await e.gateway.sign(quote, { beforeSign: async () => {} });
  const result = await e.gateway.redeem(e.url, signed, quote);
  const good = [...e.chain.values()][0];
  e.chain.set(result.transaction, { ...good, transaction: [Buffer.alloc(100).toString('base64'), 'base64'] });
  const observed = await e.gateway.reconcile(result.transaction, signed, quote);
  assert.equal(observed.payment, 'UNKNOWN');
});

test('bounded facilitator HTTP transport exercises actual SDK verify and settle wire requests', async (t) => {
  const e = await environment(t, { httpFacilitator: true });
  const quote = await e.gateway.quote(e.url);
  const signed = await e.gateway.sign(quote, { beforeSign: async () => {} });
  const result = await e.gateway.redeem(e.url, signed, quote);
  assert.equal(result.payment, 'CONFIRMED');
  assert.equal(result.delivery, 'COMPLETED');
  assert.equal(e.counts.verify, 1);
  assert.equal(e.counts.settle, 1);
});

test('delayed SDK RPC response cannot call signer after the signing deadline', async (t) => {
  const e = await environment(t, { sdkRpcDelay: 250 });
  const quote = await e.gateway.quote(e.url);
  const gateway = createGateway({ ...e.config, requestTimeoutMs: 100 }, { rpc: e.rpc });
  let called = 0;
  await assert.rejects(gateway.sign(quote, { beforeSign: async () => { called++; } }), { code: 'NETWORK_TIMEOUT' });
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(called, 0);
  assert.equal(e.counts.settle, 0);
});

test('successful HTTP without chain proof never becomes paid delivery', async (t) => {
  const e = await environment(t);
  const quote = await e.gateway.quote(e.url);
  const signed = await e.gateway.sign(quote, { beforeSign: async () => {} });
  const gateway = createGateway(e.config, { rpc: e.rpc,
    fetch: async () => new Response('{"transfers":[]}', { status: 200, headers: { 'content-type': 'application/json' } }) });
  const result = await gateway.redeem(e.url, signed, quote);
  assert.equal(result.payment, 'UNKNOWN');
  assert.equal(result.delivery, 'FAILED');
  assert.equal(result.body, undefined);
});

test('altered payer signature cannot use a paid receipt cache', async (t) => {
  const e = await environment(t);
  const quote = await e.gateway.quote(e.url);
  const signed = await e.gateway.sign(quote, { beforeSign: async () => {} });
  await e.gateway.redeem(e.url, signed, quote);
  const payload = decodePaymentSignatureHeader(signed.paymentHeader);
  const wire = Buffer.from(payload.payload.transaction, 'base64');
  wire[70] ^= 1;
  payload.payload.transaction = wire.toString('base64');
  const response = await fetch(e.url, { headers: { 'payment-signature': encodePaymentSignatureHeader(payload) } });
  assert.equal(response.status, 400);
  assert.equal(e.counts.settle, 1);
});

test('readiness and fixed diagnostic errors do not disclose invalid secret material', async (t) => {
  const e = await environment(t);
  const marker = 'private-material-never-in-diagnostics';
  const gateway = createGateway({ ...e.config, payerPrivateKey: marker });
  const ready = await gateway.readiness();
  assert.equal(ready.ready, false);
  assert.equal(ready.payer, null);
  assert.doesNotMatch(JSON.stringify(ready), new RegExp(marker));
});

test('truncated CAIP-2 reference is not accepted as the full RPC genesis hash', async (t) => {
  const e = await environment(t);
  const quote = await e.gateway.quote(e.url);
  e.setGenesis(DEVNET.slice(7));
  let called = 0;
  await assert.rejects(e.gateway.sign(quote, { beforeSign: async () => { called++; } }), { code: 'RPC_NETWORK_MISMATCH' });
  assert.equal(called, 0);
});

test('missing or malformed confirmed transaction error metadata remains UNKNOWN', async (t) => {
  const e = await environment(t);
  const quote = await e.gateway.quote(e.url);
  const signed = await e.gateway.sign(quote, { beforeSign: async () => {} });
  const completed = await e.gateway.redeem(e.url, signed, quote);
  const original = e.chain.get(completed.transaction);
  for (const meta of [undefined, {}, { err: undefined }, { err: 3 }, { err: [] }]) {
    e.chain.set(completed.transaction, { ...original, meta });
    const observed = await e.gateway.reconcile(completed.transaction, signed, quote);
    assert.equal(observed.payment, 'UNKNOWN');
  }
});

test('client disconnect cancels report work before any settlement claim or payment', async (t) => {
  const gate = deferred(), e = await environment(t, { reportGate: gate });
  const quote = await e.gateway.quote(e.url);
  const signed = await e.gateway.sign(quote, { beforeSign: async () => {} });
  const controller = new AbortController();
  const pending = fetch(e.url, { signal: controller.signal, headers: { 'payment-signature': signed.paymentHeader } });
  await e.reportEntered.promise;
  controller.abort();
  await assert.rejects(pending);
  await e.reportAborted.promise;
  gate.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(e.records.size, 0);
  assert.equal(e.counts.settle, 0);
});

test('an abort-ignoring provider retains its admission and work lease until it stops, then original proof retry succeeds', async (t) => {
  const gate = deferred(), e = await environment(t, { lifecycle: true, reportGate: gate, merchantLimit: 1 });
  const quote = await e.gateway.quote(e.url);
  let signs = 0;
  const signed = await e.gateway.sign(quote, { beforeSign: async () => { signs++; } });
  const controller = new AbortController();
  const pending = fetch(e.url, { signal: controller.signal, headers: { 'payment-signature': signed.paymentHeader } });
  try {
    await e.reportEntered.promise;
    controller.abort(); await assert.rejects(pending); await e.reportAborted.promise;
    await until(() => e.lifecycle.counts().requests === 0);
    assert.equal(e.lifecycle.counts().work, 1); assert.equal(e.records.size, 0); assert.equal(e.counts.settle, 0);
    const busy = await fetch(e.url, { headers: { 'payment-signature': signed.paymentHeader } });
    assert.equal(busy.status, 429); assert.deepEqual(await busy.json(), { reasonCode: 'MERCHANT_BUSY' });
    assert.equal(e.counts.verify, 1); assert.equal(e.counts.reports, 1); assert.equal(e.counts.claims, 0);
    gate.resolve(); await until(() => e.lifecycle.counts().work === 0);
    const retried = await fetch(e.url, { headers: { 'payment-signature': signed.paymentHeader } });
    assert.equal(retried.status, 200); await retried.text();
    assert.equal(signs, 1); assert.equal(e.counts.verify, 2); assert.equal(e.counts.reports, 2); assert.equal(e.counts.settle, 1);
  } finally { controller.abort(); gate.resolve(); await pending.catch(() => {}); }
});

test('merchant total request deadline cancels report and prevents a late settlement', async (t) => {
  const gate = deferred(), e = await environment(t, { reportGate: gate });
  const quote = await e.gateway.quote(e.url);
  const signed = await e.gateway.sign(quote, { beforeSign: async () => {} });
  e.config.requestTimeoutMs = 100;
  const response = await fetch(e.url, { headers: { 'payment-signature': signed.paymentHeader } });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).reasonCode, 'MERCHANT_REQUEST_ABORTED');
  await e.reportAborted.promise;
  gate.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(e.records.size, 0);
  assert.equal(e.counts.settle, 0);
});

test('disconnect after settlement starts preserves durable outcome for identical proof recovery', async (t) => {
  const gate = deferred(), e = await environment(t, { lifecycle: true, settlementGate: gate });
  const quote = await e.gateway.quote(e.url);
  const signed = await e.gateway.sign(quote, { beforeSign: async () => {} });
  const controller = new AbortController();
  const pending = fetch(e.url, { signal: controller.signal, headers: { 'payment-signature': signed.paymentHeader } });
  await e.settleEntered.promise;
  assert.equal(e.records.size, 1);
  controller.abort();
  await assert.rejects(pending);
  await until(() => e.lifecycle.counts().requests === 0);
  assert.equal(e.lifecycle.counts().work, 1);
  gate.resolve();
  await e.settlementCompleted.promise;
  await until(() => e.lifecycle.counts().work === 0);
  const recovered = await e.gateway.redeem(e.url, signed, quote);
  assert.equal(recovered.payment, 'CONFIRMED');
  assert.equal(recovered.delivery, 'COMPLETED');
  assert.equal(e.counts.settle, 1);
  assert.equal([...e.records.values()][0].status, 'SETTLED');
});

test('forced HTTP shutdown preserves the store until actual SDK settlement receipt persistence finishes', async (t) => {
  const gate = deferred(), e = await environment(t, { lifecycle: true, httpFacilitator: true, settledPutGate: gate });
  const quote = await e.gateway.quote(e.url);
  const signed = await e.gateway.sign(quote, { beforeSign: async () => {} });
  const pending = fetch(e.url, { headers: { 'payment-signature': signed.paymentHeader } }).catch(error => ({ error }));
  const close = createShutdown({ server: e.server, store: e.store, lifecycle: e.lifecycle, graceMs: 15 });
  try {
    await e.settledPutEntered.promise;
    assert.equal(e.counts.verify, 1); assert.equal(e.counts.settle, 1);
    assert.equal([...e.records.values()][0].status, 'PENDING');
    const result = await close();
    assert.deepEqual(result, { drained: false, storeClosed: false, forcedHttpClose: true });
    assert.ok((await pending).error);
    await until(() => e.lifecycle.counts().requests === 0);
    assert.equal(e.lifecycle.counts().work, 1); assert.equal(e.storeState.closes, 0);
    gate.resolve(); await until(() => e.storeState.closes === 1);
    await e.settledPutCompleted.promise;
    assert.equal([...e.records.values()][0].status, 'SETTLED');
    assert.equal(e.counts.settle, 1); assert.deepEqual(e.lifecycle.counts(), { requests: 0, work: 0 });
    assert.strictEqual(await close(), result); assert.equal(e.storeState.closes, 1);
  } finally { gate.resolve(); await close(); await pending; }
});

for (const boundary of ['claim', 'pendingPut']) {
  test(`forced HTTP shutdown during an async ${boundary} preserves its claim without starting settlement`, async (t) => {
    const gate = deferred(), e = await environment(t, { lifecycle: true, [boundary + 'Gate']: gate });
    const quote = await e.gateway.quote(e.url);
    const signed = await e.gateway.sign(quote, { beforeSign: async () => {} });
    const pending = fetch(e.url, { headers: { 'payment-signature': signed.paymentHeader } }).catch(error => ({ error }));
    const close = createShutdown({ server: e.server, store: e.store, lifecycle: e.lifecycle, graceMs: 15 });
    try {
      await e[boundary + 'Entered'].promise;
      assert.deepEqual(await close(), { drained: false, storeClosed: false, forcedHttpClose: true });
      assert.ok((await pending).error); await e.reportAborted.promise;
      assert.equal(e.storeState.closes, 0); assert.equal(e.lifecycle.counts().work, 1);
      gate.resolve(); await until(() => e.storeState.closes === 1);
      assert.equal(e.counts.settle, 0); assert.equal(e.counts.claims, 1);
      assert.equal(e.records.size, 1); assert.equal([...e.records.values()][0].status, 'PENDING');
      assert.deepEqual(e.lifecycle.counts(), { requests: 0, work: 0 });
    } finally { gate.resolve(); await close(); await pending; }
  });
}

test('disconnect during async receipt claim cannot start settlement after the claim resolves', async (t) => {
  const gate = deferred(), e = await environment(t, { claimGate: gate });
  const quote = await e.gateway.quote(e.url);
  const signed = await e.gateway.sign(quote, { beforeSign: async () => {} });
  const controller = new AbortController();
  const pending = fetch(e.url, { signal: controller.signal, headers: { 'payment-signature': signed.paymentHeader } });
  await e.claimEntered.promise;
  controller.abort();
  await assert.rejects(pending);
  await e.reportAborted.promise;
  gate.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(e.counts.settle, 0);
  assert.equal(e.records.size, 1, 'the successful durable claim remains, conservatively blocking a replacement');
  assert.equal([...e.records.values()][0].status, 'PENDING');
});

test('disconnect during pending receipt write cannot start settlement after persistence resolves', async (t) => {
  const gate = deferred(), e = await environment(t, { pendingPutGate: gate });
  const quote = await e.gateway.quote(e.url);
  const signed = await e.gateway.sign(quote, { beforeSign: async () => {} });
  const controller = new AbortController();
  const pending = fetch(e.url, { signal: controller.signal, headers: { 'payment-signature': signed.paymentHeader } });
  await e.pendingPutEntered.promise;
  controller.abort();
  await assert.rejects(pending);
  await e.reportAborted.promise;
  gate.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(e.counts.settle, 0);
  assert.equal(e.records.size, 1);
  assert.equal([...e.records.values()][0].status, 'PENDING');
  assert.equal(typeof [...e.records.values()][0].body, 'string');
});
