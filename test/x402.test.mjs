// Real SDK construction and loopback HTTP; facilitator/RPC outcomes are scripted.
// These tests are not evidence of external Solana settlement.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import express from 'express';
import {
  createKeyPairSignerFromBytes, getBase58Decoder, getBase64EncodedWireTransaction,
  getSignatureFromTransaction, getTransactionDecoder,
} from '@solana/kit';
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentSignatureHeader } from '@x402/core/http';
import { TOKEN_PROGRAM_ADDRESS } from '@x402/svm';
import { createGateway, mountMerchant, DEVNET } from '../service/x402.mjs';
const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
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
  return `http://127.0.0.1:${server.address().port}`;
}

async function environment(t, opts = {}) {
  const payer = key(), feePayer = key(), merchant = key(), mint = key(), blockhash = key();
  const feeSigner = await createKeyPairSignerFromBytes(feePayer.bytes);
  const chain = new Map();
  const counts = { settle: 0, verify: 0, reports: 0, rpc: [] };
  const reportEntered = deferred(), reportAborted = deferred(), settleEntered = deferred(), settlementCompleted = deferred();
  const claimEntered = deferred(), pendingPutEntered = deferred();
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
  const rpcOrigin = await listen(rpcApp, t);
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
  const origin = await listen(app, t);
  const config = { network: DEVNET, rpcUrl: rpcOrigin, facilitatorUrl: `${rpcOrigin}/facilitator`,
    merchantOrigin: origin, merchantPayTo: merchant.address, asset: mint.address,
    assetDecimals: 6, amountAtomic: '1000', paymentEnabled: true,
    payerPrivateKey: payer.bytes.toString('base64'), requestTimeoutMs: 2000 };
  const records = new Map();
  const receiptStore = {
    get(key) { return records.get(key); },
    async put(key, value) {
      if (opts.pendingPutGate && value.status === 'PENDING') {
        pendingPutEntered.resolve();
        await opts.pendingPutGate.promise;
      }
      records.set(key, structuredClone(value));
    },
    async claim(key) {
      if (opts.claimGate) { claimEntered.resolve(); await opts.claimGate.promise; }
      if (records.has(key)) return false;
      records.set(key, { status: 'PENDING' }); return true;
    },
  };
  mountMerchant(app, { config, rpc, facilitator: opts.httpFacilitator ? undefined : facilitator, receiptStore, reportProvider: async ({ resourceRef, wallet, signal }) => {
    counts.reports++;
    if (opts.claimGate || opts.pendingPutGate) signal.addEventListener('abort', () => reportAborted.resolve(), { once: true });
    if (opts.reportGate) {
      signal.addEventListener('abort', () => reportAborted.resolve(), { once: true });
      reportEntered.resolve();
      // Deliberately ignore cancellation until released, to prove the merchant
      // cannot start settlement when a late report eventually completes.
      await opts.reportGate.promise;
    }
    if (opts.providerFailure) throw new Error('Scripted provider unavailable');
    return { schema_version: 'analytics-reference/v1', resource_ref: resourceRef, wallet, transfers: [] };
  } });
  const url = `${origin}/merchant/reports/purchase-1?wallet=${payer.address}&start=2026-11-01T00%3A00%3A00.000Z&end=2026-11-02T00%3A00%3A00.000Z`;
  const gateway = createGateway(config, { rpc });
  return { app, config, url, gateway, counts, chain, records, payer, rpc,
    reportEntered, reportAborted, settleEntered, settlementCompleted, claimEntered, pendingPutEntered,
    setGenesis(value) { genesis = value; }, setDecimals(value) { decimals = value; } };
}

test('real SDK 402 -> partial signing -> scripted settlement -> bound resource and cached recovery', async (t) => {
  const e = await environment(t);
  const quoted = await e.gateway.quote(e.url);
  assert.equal(quoted.paymentRequired.x402Version, 2);
  assert.equal(quoted.requirements.network, DEVNET);
  assert.equal(quoted.requirements.amount, '1000');
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
  const origin = await listen(server, t);
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
  const gate = deferred(), e = await environment(t, { settlementGate: gate });
  const quote = await e.gateway.quote(e.url);
  const signed = await e.gateway.sign(quote, { beforeSign: async () => {} });
  const controller = new AbortController();
  const pending = fetch(e.url, { signal: controller.signal, headers: { 'payment-signature': signed.paymentHeader } });
  await e.settleEntered.promise;
  assert.equal(e.records.size, 1);
  controller.abort();
  await assert.rejects(pending);
  gate.resolve();
  await e.settlementCompleted.promise;
  // Let the handler persist the settlement observation after the chain reply.
  await new Promise(resolve => setImmediate(resolve));
  const recovered = await e.gateway.redeem(e.url, signed, quote);
  assert.equal(recovered.payment, 'CONFIRMED');
  assert.equal(recovered.delivery, 'COMPLETED');
  assert.equal(e.counts.settle, 1);
  assert.equal([...e.records.values()][0].status, 'SETTLED');
});

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
