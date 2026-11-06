import { createHash, createPublicKey, verify } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  createKeyPairSignerFromBytes, getAddressEncoder,
  getBase58Encoder, getCompiledTransactionMessageDecoder,
  getInstructionsFromCompiledTransactionMessage, getProgramDerivedAddress,
  getSignatureFromTransaction, getTransactionDecoder, isAddress,
} from '@solana/kit';
import { x402Client } from '@x402/core/client';
import { HTTPFacilitatorClient, x402ResourceServer } from '@x402/core/server';
import {
  decodePaymentRequiredHeader, decodePaymentResponseHeader,
  decodePaymentSignatureHeader, encodePaymentRequiredHeader,
  encodePaymentResponseHeader, encodePaymentSignatureHeader,
} from '@x402/core/http';
import { validatePaymentPayload, validatePaymentRequired } from '@x402/core/schemas';
import { ExactSvmScheme as ExactSvmClient } from '@x402/svm/exact/client';
import { ExactSvmScheme as ExactSvmServer } from '@x402/svm/exact/server';
import {
  COMPUTE_BUDGET_PROGRAM_ADDRESS, DEFAULT_COMPUTE_UNIT_LIMIT,
  DEFAULT_COMPUTE_UNIT_PRICE_MICROLAMPORTS, MEMO_PROGRAM_ADDRESS,
  SOLANA_DEVNET_CAIP2, TOKEN_PROGRAM_ADDRESS, TOKEN_2022_PROGRAM_ADDRESS,
} from '@x402/svm';

export const DEVNET = SOLANA_DEVNET_CAIP2;
// RPC returns the full genesis hash; the CAIP-2 identifier uses its prefix.
const GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const MAX_PROOF = 12_000;
const MAX_BODY = 256_000;
const amountPattern = /^[1-9][0-9]{0,18}$/;

export class GatewayError extends Error {
  constructor(code) { super(code); this.name = 'GatewayError'; this.code = code; }
}
const fail = (code) => { throw new GatewayError(code); };
const hash = (value) => createHash('sha256').update(value).digest('hex');
const memoFor = (url) => `floww:${hash(url)}`;
const clone = (value) => JSON.parse(JSON.stringify(value));
const knownAddress = (value) => typeof value === 'string' && isAddress(value);
const signatureOK = (value) => {
  try { return typeof value === 'string' && getBase58Encoder().encode(value).length === 64; }
  catch { return false; }
};

function timeoutMs(config) {
  const value = config.requestTimeoutMs ?? 10_000;
  if (!Number.isInteger(value) || value < 100 || value > 30_000) fail('INVALID_TIMEOUT');
  return value;
}

function trustedEndpoint(value, originOnly = false) {
  try {
    const url = new URL(value);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.hash ||
        (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
        (originOnly && (url.pathname !== '/' || url.search))) fail('INVALID_ENDPOINT');
    return url;
  } catch { fail('INVALID_ENDPOINT'); }
}

function configCheck(config) {
  if (config.network !== DEVNET) fail('DEVNET_ONLY');
  trustedEndpoint(config.rpcUrl);
  trustedEndpoint(config.facilitatorUrl);
  trustedEndpoint(config.merchantOrigin, true);
  if (!knownAddress(config.asset) || !knownAddress(config.merchantPayTo) ||
      !Number.isInteger(config.assetDecimals) || config.assetDecimals < 0 || config.assetDecimals > 18 ||
      !amountPattern.test(config.amountAtomic ?? '')) fail('INVALID_PAYMENT_CONFIG');
  timeoutMs(config);
}

function resourceURL(input, config) {
  const url = trustedEndpoint(input);
  if (url.origin !== new URL(config.merchantOrigin).origin ||
      !/^\/merchant\/reports\/[A-Za-z0-9-]{1,100}$/.test(url.pathname) ||
      [...url.searchParams.keys()].some((key) => !['wallet', 'start', 'end'].includes(key)) ||
      ['wallet', 'start', 'end'].some((key) => url.searchParams.getAll(key).length !== 1) ||
      !knownAddress(url.searchParams.get('wallet'))) fail('UNAPPROVED_RESOURCE');
  const start = Date.parse(url.searchParams.get('start'));
  const end = Date.parse(url.searchParams.get('end'));
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end ||
      end > Date.now() || end - start > 7 * 86_400_000) fail('INVALID_REPORT_WINDOW');
  return url.href;
}

function validateRequirements(requirements, url, config) {
  if (!requirements || requirements.scheme !== 'exact' || requirements.network !== DEVNET ||
      requirements.asset !== config.asset || requirements.payTo !== config.merchantPayTo ||
      requirements.amount !== config.amountAtomic ||
      !Number.isInteger(requirements.maxTimeoutSeconds) || requirements.maxTimeoutSeconds < 1 ||
      requirements.maxTimeoutSeconds > 300 || !knownAddress(requirements.extra?.feePayer) ||
      requirements.extra?.memo !== memoFor(url) ||
      (requirements.extra?.paymentFlow !== undefined && requirements.extra.paymentFlow !== 'authorization') ||
      (requirements.extra?.assetTransferMethod !== undefined && requirements.extra.assetTransferMethod !== 'default')) {
    fail('UNAPPROVED_PAYMENT_TERMS');
  }
  return requirements;
}

async function limitedText(response, limit = MAX_BODY) {
  if (Number(response.headers.get('content-length')) > limit) fail('RESPONSE_TOO_LARGE');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) fail('RESPONSE_TOO_LARGE');
      chunks.push(value);
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } finally { await reader.cancel().catch(() => {}); }
}

async function bounded(promise, milliseconds, onTimeout = () => {}) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => { onTimeout(); reject(new GatewayError('NETWORK_TIMEOUT')); }, milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

async function cancellableReport(promise, signal) {
  let aborted;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      aborted = () => reject(new GatewayError('MERCHANT_REQUEST_ABORTED'));
      signal.addEventListener('abort', aborted, { once: true });
      if (signal.aborted) aborted();
    })]);
  } finally { signal.removeEventListener('abort', aborted); }
}

function transport(config, fetchImpl) {
  return async (url, init = {}, limit = MAX_BODY) => {
    const response = await fetchImpl(url, {
      ...init, redirect: 'error', signal: AbortSignal.timeout(timeoutMs(config)),
    });
    const text = await limitedText(response, limit);
    return { response, text };
  };
}

// The upstream SDK transport follows redirects. Keep its public client interface
// but constrain the transport before any payment payload leaves this process.
class StrictFacilitatorClient extends HTTPFacilitatorClient {
  constructor(config, fetchImpl) {
    super({ url: config.facilitatorUrl, timeoutMs: timeoutMs(config) });
    this.request = transport(config, fetchImpl);
  }
  async call(method, payload, requirements) {
    const init = method === 'supported' ? { method: 'GET' } : {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ x402Version: 2, paymentPayload: payload, paymentRequirements: requirements }),
    };
    const { response, text } = await this.request(`${this.url}/${method}`, init, 64_000);
    if (!response.ok) fail('FACILITATOR_UNAVAILABLE');
    let value;
    try { value = JSON.parse(text); } catch { fail('INVALID_FACILITATOR_RESPONSE'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_FACILITATOR_RESPONSE');
    if (method === 'supported' && (!Array.isArray(value.kinds) || !Array.isArray(value.extensions) ||
        typeof value.signers !== 'object')) fail('INVALID_FACILITATOR_RESPONSE');
    if (method === 'verify' && typeof value.isValid !== 'boolean') fail('INVALID_FACILITATOR_RESPONSE');
    if (method === 'settle' && (typeof value.success !== 'boolean' ||
        typeof value.network !== 'string' || typeof value.transaction !== 'string')) fail('INVALID_FACILITATOR_RESPONSE');
    return value;
  }
  verify(payload, requirements) { return this.call('verify', payload, requirements); }
  settle(payload, requirements) { return this.call('settle', payload, requirements); }
  getSupported() { return this.call('supported'); }
}

function makeRpc(config, dependencies) {
  if (dependencies.rpc) return async (method, params = []) =>
    bounded(Promise.resolve().then(() => dependencies.rpc(method, params)), timeoutMs(config));
  const request = transport(config, dependencies.fetch ?? fetch);
  return async (method, params = []) => {
    const { response, text } = await request(config.rpcUrl, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }, 1_000_000);
    let value;
    try { value = JSON.parse(text); } catch { fail('RPC_UNAVAILABLE'); }
    if (!response.ok || value?.error || !Object.hasOwn(value ?? {}, 'result')) fail('RPC_UNAVAILABLE');
    return value.result;
  };
}

function decodeWire(encoded) {
  try {
    if (typeof encoded !== 'string' || encoded.length > MAX_PROOF ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) fail('INVALID_PAYMENT_PROOF');
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.toString('base64') !== encoded || bytes.length > 4096) fail('INVALID_PAYMENT_PROOF');
    return getTransactionDecoder().decode(bytes);
  } catch { fail('INVALID_PAYMENT_PROOF'); }
}

async function ata(owner, mint, tokenProgram) {
  const encoder = getAddressEncoder();
  const [address] = await getProgramDerivedAddress({
    programAddress: ATA_PROGRAM,
    seeds: [encoder.encode(owner), encoder.encode(tokenProgram), encoder.encode(mint)],
  });
  return address;
}

async function inspectTransaction(transaction, requirements, url, config, expectedPayer) {
  validateRequirements(requirements, url, config);
  let instructions, compiled;
  try {
    compiled = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
    if (compiled.version !== 0) fail('UNSUPPORTED_TRANSACTION_VERSION');
    if (compiled.staticAccounts?.[0] !== requirements.extra.feePayer) fail('UNAPPROVED_FEE_PAYER');
    instructions = getInstructionsFromCompiledTransactionMessage(compiled);
  } catch { fail('INVALID_PAYMENT_PROOF'); }
  if (instructions.length !== 4) fail('UNAPPROVED_INSTRUCTIONS');
  const [limit, fee, transfer, memo] = instructions;
  const l = Buffer.from(limit.data ?? []), f = Buffer.from(fee.data ?? []), data = Buffer.from(transfer.data ?? []);
  if (limit.programAddress !== COMPUTE_BUDGET_PROGRAM_ADDRESS || l.length !== 5 || l[0] !== 2 ||
      l.readUInt32LE(1) !== DEFAULT_COMPUTE_UNIT_LIMIT ||
      fee.programAddress !== COMPUTE_BUDGET_PROGRAM_ADDRESS || f.length !== 9 || f[0] !== 3 ||
      f.readBigUInt64LE(1) !== BigInt(DEFAULT_COMPUTE_UNIT_PRICE_MICROLAMPORTS) ||
      ![TOKEN_PROGRAM_ADDRESS, TOKEN_2022_PROGRAM_ADDRESS].includes(transfer.programAddress) ||
      data.length !== 10 || data[0] !== 12 || data.readBigUInt64LE(1).toString() !== requirements.amount ||
      data[9] !== config.assetDecimals || transfer.accounts?.length !== 4 ||
      memo.programAddress !== MEMO_PROGRAM_ADDRESS || (memo.accounts?.length ?? 0) !== 0 ||
      new TextDecoder('utf-8', { fatal: true }).decode(memo.data) !== memoFor(url)) fail('UNAPPROVED_INSTRUCTIONS');
  const [source, mint, destination, authority] = transfer.accounts.map((account) => account.address);
  if (!knownAddress(authority) || (expectedPayer && authority !== expectedPayer) || mint !== requirements.asset ||
      source !== await ata(authority, mint, transfer.programAddress) ||
      destination !== await ata(requirements.payTo, mint, transfer.programAddress)) fail('UNAPPROVED_TRANSFER');
  // This also runs immediately before a first signature is produced, so a null
  // authority signature is allowed there; incoming proof validation requires it.
  return { messageHash: hash(transaction.messageBytes), payer: authority };
}

async function inspectProof(header, quote, config) {
  if (typeof header !== 'string' || header.length > MAX_PROOF) fail('INVALID_PAYMENT_PROOF');
  let payload;
  try { payload = validatePaymentPayload(decodePaymentSignatureHeader(header)); }
  catch { fail('INVALID_PAYMENT_PROOF'); }
  if (payload.x402Version !== 2 || Object.keys(payload.payload ?? {}).join(',') !== 'transaction' ||
      payload.resource?.url !== quote.resourceUrl ||
      !isDeepStrictEqual(payload.accepted, quote.requirements) ||
      Object.keys(payload.extensions ?? {}).length !== 0) fail('PAYMENT_BINDING_MISMATCH');
  const transaction = decodeWire(payload.payload.transaction);
  const details = await inspectTransaction(transaction, payload.accepted, quote.resourceUrl, config);
  const payerSignature = transaction.signatures[details.payer];
  if (!payerSignature || payerSignature.length !== 64) fail('INVALID_PAYER_SIGNATURE');
  const publicKey = createPublicKey({ format: 'der', type: 'spki', key: Buffer.concat([
    Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(getAddressEncoder().encode(details.payer)),
  ]) });
  if (!verify(null, transaction.messageBytes, publicKey, payerSignature)) fail('INVALID_PAYER_SIGNATURE');
  return { payload, transaction, ...details };
}

async function privateSigner(config) {
  try {
    const value = config.payerPrivateKey;
    let bytes;
    if (typeof value === 'string' && value.trim().startsWith('[')) {
      const parsed = JSON.parse(value);
      if (!Array.isArray(parsed) || parsed.length !== 64 ||
          parsed.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) fail('INVALID_SIGNER');
      bytes = Uint8Array.from(parsed);
    } else if (typeof value === 'string') {
      bytes = Buffer.from(value, 'base64');
      if (bytes.length !== 64 || bytes.toString('base64') !== value) fail('INVALID_SIGNER');
    } else if (value instanceof Uint8Array && value.length === 64) bytes = value;
    else fail('INVALID_SIGNER');
    return await createKeyPairSignerFromBytes(bytes);
  } catch { fail('INVALID_SIGNER'); }
}

export function createGateway(config, dependencies = {}) {
  const request = transport(config, dependencies.fetch ?? fetch);
  const rpc = makeRpc(config, dependencies);
  let signerPromise;
  const signer = () => signerPromise ??= privateSigner(config);

  async function readiness() {
    const missing = [];
    try { configCheck(config); } catch { missing.push('payment_configuration'); }
    if (!config.paymentEnabled) missing.push('payment_enabled');
    let payer = null;
    if (!config.payerPrivateKey) missing.push('payer_private_key');
    else {
      try { payer = (await signer()).address; }
      catch { missing.push('valid_payer_private_key'); }
    }
    return { ready: missing.length === 0, missing, payer };
  }

  async function quote(input) {
    try {
      configCheck(config);
      const url = resourceURL(input, config);
      const { response } = await request(url, { headers: { accept: 'application/json' } }, 64_000);
      if (response.status !== 402) fail('PAYMENT_CHALLENGE_REQUIRED');
      const header = response.headers.get('payment-required');
      if (!header || header.length > 16_000) fail('INVALID_PAYMENT_CHALLENGE');
      let required;
      try { required = validatePaymentRequired(decodePaymentRequiredHeader(header)); }
      catch { fail('INVALID_PAYMENT_CHALLENGE'); }
      if (required.x402Version !== 2 || required.resource?.url !== url || required.accepts.length !== 1 ||
          Object.keys(required.extensions ?? {}).length !== 0) fail('INVALID_PAYMENT_CHALLENGE');
      validateRequirements(required.accepts[0], url, config);
      return { paymentRequired: clone(required), requirements: clone(required.accepts[0]), resourceUrl: url, quotedAt: new Date().toISOString() };
    } catch (error) { throw error instanceof GatewayError ? error : new GatewayError('QUOTE_UNAVAILABLE'); }
  }

  async function sign(quoted, { beforeSign } = {}) {
    let active = true;
    try {
      configCheck(config);
      const ready = await readiness();
      if (!ready.ready || typeof beforeSign !== 'function') fail('SIGNING_NOT_READY');
      const url = resourceURL(quoted.resourceUrl, config);
      validateRequirements(quoted.requirements, url, config);
      if (quoted.paymentRequired?.x402Version !== 2 || quoted.paymentRequired.resource?.url !== url ||
          quoted.paymentRequired.accepts?.length !== 1 ||
          !isDeepStrictEqual(quoted.paymentRequired.accepts[0], quoted.requirements)) fail('PAYMENT_BINDING_MISMATCH');
      if (await rpc('getGenesisHash') !== GENESIS) fail('RPC_NETWORK_MISMATCH');
      const mint = await rpc('getAccountInfo', [config.asset, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
      if (mint?.value?.data?.parsed?.info?.decimals !== config.assetDecimals ||
          ![TOKEN_PROGRAM_ADDRESS, TOKEN_2022_PROGRAM_ADDRESS].includes(mint?.value?.owner)) fail('ASSET_DECIMALS_MISMATCH');
      const key = await signer();
      const guardedSigner = {
        address: key.address,
        signTransactions: async (transactions, options) => {
          if (!active) fail('SIGNING_DEADLINE_EXCEEDED');
          if (transactions.length !== 1) fail('UNAPPROVED_INSTRUCTIONS');
          await inspectTransaction(transactions[0], quoted.requirements, url, config, key.address);
          await beforeSign();
          if (!active) fail('SIGNING_DEADLINE_EXCEEDED');
          return key.signTransactions(transactions, options);
        },
      };
      const client = new x402Client().register(DEVNET,
        new ExactSvmClient(guardedSigner, { rpcUrl: config.rpcUrl, transactionVersions: [0] }));
      client.setSpendControls({ maxAmountPerPayment: false, allowedAssets: [
        { network: DEVNET, asset: config.asset, maxAmountPerPayment: config.amountAtomic },
      ] });
      const payload = await bounded(client.createPaymentPayload(clone(quoted.paymentRequired)), timeoutMs(config), () => { active = false; });
      const header = encodePaymentSignatureHeader(payload);
      const inspected = await inspectProof(header, quoted, config);
      let signature = null;
      try { signature = getSignatureFromTransaction(inspected.transaction); } catch { /* facilitator signs fee-payer later */ }
      return { paymentHeader: header, signature, payer: key.address, messageHash: inspected.messageHash,
        requirements: clone(quoted.requirements), resourceUrl: url };
    } catch (error) { throw error instanceof GatewayError ? error : new GatewayError('SIGNING_UNAVAILABLE'); }
    finally { active = false; }
  }

  async function reconcile(signature, signed, quoted) {
    try {
      configCheck(config);
      resourceURL(quoted.resourceUrl, config);
      const inspected = await inspectProof(signed.paymentHeader, quoted, config);
      if (inspected.messageHash !== signed.messageHash || inspected.payer !== signed.payer) fail('PAYMENT_BINDING_MISMATCH');
      if (await rpc('getGenesisHash') !== GENESIS) fail('RPC_NETWORK_MISMATCH');
      let signatures = [];
      if (signatureOK(signature)) signatures = [signature];
      else {
        const recent = await rpc('getSignaturesForAddress', [inspected.payer, { limit: 25, commitment: 'confirmed' }]);
        if (!Array.isArray(recent) || recent.length > 25) fail('INVALID_RPC_RESPONSE');
        signatures = recent.map((entry) => entry.signature).filter(signatureOK);
      }
      for (const candidate of signatures) {
        const chain = await rpc('getTransaction', [candidate, { encoding: 'base64', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]);
        if (!chain || !Array.isArray(chain.transaction) || chain.transaction[1] !== 'base64') continue;
        const tx = decodeWire(chain.transaction[0]);
        if (hash(tx.messageBytes) !== inspected.messageHash || getSignatureFromTransaction(tx) !== candidate) continue;
        if (!chain.meta || typeof chain.meta !== 'object' || !Object.hasOwn(chain.meta, 'err')) continue;
        if (chain.meta.err !== null) {
          if (typeof chain.meta.err === 'string' || (typeof chain.meta.err === 'object' &&
              chain.meta.err !== null && !Array.isArray(chain.meta.err) && Object.keys(chain.meta.err).length > 0)) {
            return { payment: 'FAILED', transaction: candidate, reasonCode: 'TRANSACTION_FAILED' };
          }
          continue;
        }
        const statuses = await rpc('getSignatureStatuses', [[candidate], { searchTransactionHistory: true }]);
        const status = statuses?.value?.[0];
        if (status?.err !== null || !['confirmed', 'finalized'].includes(status.confirmationStatus)) continue;
        return { payment: 'CONFIRMED', transaction: candidate, reasonCode: 'CHAIN_CONFIRMED' };
      }
      return { payment: 'UNKNOWN', reasonCode: 'SETTLEMENT_UNCONFIRMED' };
    } catch { return { payment: 'UNKNOWN', reasonCode: 'RECONCILIATION_UNAVAILABLE' }; }
  }

  async function redeem(input, signed, quoted) {
    let response, text, receipt;
    try {
      configCheck(config);
      const url = resourceURL(input, config);
      if (url !== quoted.resourceUrl || signed.resourceUrl !== url) fail('PAYMENT_BINDING_MISMATCH');
      await inspectProof(signed.paymentHeader, quoted, config);
      ({ response, text } = await request(url, { headers: { accept: 'application/json', 'payment-signature': signed.paymentHeader } }));
      const header = response.headers.get('payment-response');
      if (header && header.length <= 16_000) {
        try { receipt = decodePaymentResponseHeader(header); } catch { /* retain unknown receipt */ }
      }
    } catch { /* The request may already have settled; always reobserve the saved message. */ }
    const receiptValid = receipt?.success === true && receipt.network === DEVNET && signatureOK(receipt.transaction) &&
      (!receipt.payer || receipt.payer === signed.payer) && (!receipt.amount || receipt.amount === quoted.requirements.amount);
    const observed = await bounded(reconcile(receiptValid ? receipt.transaction : signed.signature, signed, quoted), timeoutMs(config))
      .catch(() => ({ payment: 'UNKNOWN', reasonCode: 'RECONCILIATION_UNAVAILABLE' }));
    if (observed.payment !== 'CONFIRMED') return { ...observed, delivery: 'FAILED', nextAction: 'reconcile_original_payment' };
    const media = response?.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (!receiptValid || receipt.transaction !== observed.transaction || !response?.ok || media !== 'application/json' || !text) {
      return { ...observed, delivery: 'FAILED', reasonCode: 'PAID_RESOURCE_UNAVAILABLE', nextAction: 'recover_original_payment' };
    }
    try { JSON.parse(text); } catch {
      return { ...observed, delivery: 'FAILED', reasonCode: 'INVALID_PAID_RESOURCE', nextAction: 'recover_original_payment' };
    }
    return { ...observed, delivery: 'COMPLETED', body: text,
      response: { network: DEVNET, transaction: observed.transaction, payer: signed.payer,
        amount: quoted.requirements.amount, bodySha256: hash(text) }, reasonCode: 'RESOURCE_DELIVERED' };
  }

  return { readiness, quote, sign, redeem, reconcile };
}

export function mountMerchant(app, { config, reportProvider, receiptStore, fetch: fetchImpl = fetch, rpc, facilitator,
  trackWork = action => action() } = {}) {
  let server, initialized;
  const activeLimit = config.maxConcurrentOperations ?? 4;
  if (!Number.isInteger(activeLimit) || activeLimit < 1 || activeLimit > 32) fail('INVALID_MERCHANT_LIMIT');
  if (typeof trackWork !== 'function') fail('MERCHANT_NOT_CONFIGURED');
  let active = 0;
  // This is bounded, process-local admission only. Durable proof ownership still
  // starts after verification/report preparation; unverified input cannot claim it.
  const activeProofs = new Set();
  const busy = res => res.set('Retry-After', '1').status(429).json({ reasonCode: 'MERCHANT_BUSY' });
  const gateway = createGateway(config, { fetch: fetchImpl, rpc });
  function resourceServer() {
    if (!server) {
      configCheck(config);
      if (!receiptStore?.get || !receiptStore?.put || !receiptStore?.claim || typeof reportProvider !== 'function') fail('MERCHANT_NOT_CONFIGURED');
      server = new x402ResourceServer(facilitator ?? new StrictFacilitatorClient(config, fetchImpl))
        .register(DEVNET, new ExactSvmServer());
    }
    return server;
  }
  async function initialize() {
    const value = resourceServer();
    if (!initialized) initialized = value.initialize().catch(() => { initialized = undefined; fail('FACILITATOR_UNAVAILABLE'); });
    await initialized;
    return value;
  }
  // A closed HTTP socket does not finish settlement or durable bookkeeping.
  // Keep the complete handler visible to shutdown until that work has settled.
  app.get('/merchant/reports/:resourceId', (req, res) => trackWork(async () => {
    res.set('cache-control', 'private, no-store');
    if (active >= activeLimit) return busy(res);
    active++;
    let activeProofKey;
    const reportController = new AbortController();
    let reportTimer, reportWork;
    const abortReport = () => reportController.abort();
    const onClose = () => { if (!res.writableFinished) abortReport(); };
    req.once('aborted', abortReport);
    res.once('close', onClose);
    const cleanupReport = () => {
      clearTimeout(reportTimer);
      req.removeListener('aborted', abortReport);
      res.removeListener('close', onClose);
    };
    const assertActiveReport = () => {
      if (reportController.signal.aborted || req.aborted || res.destroyed) fail('MERCHANT_REQUEST_ABORTED');
    };
    try {
      reportTimer = setTimeout(abortReport, timeoutMs(config));
      const url = resourceURL(`${new URL(config.merchantOrigin).origin}${req.originalUrl}`, config);
      const header = req.get('payment-signature');
      let payload;
      if (header) {
        if (header.length > MAX_PROOF) fail('INVALID_PAYMENT_PROOF');
        try { payload = validatePaymentPayload(decodePaymentSignatureHeader(header)); }
        catch { fail('INVALID_PAYMENT_PROOF'); }
        // Key the temporary lease by actual message bytes, so re-encoding the
        // same signed proof cannot multiply facilitator or provider work.
        const proofKey = hash(`${url}\n${hash(decodeWire(payload.payload?.transaction).messageBytes)}`);
        if (activeProofs.has(proofKey)) return busy(res);
        activeProofs.add(proofKey); activeProofKey = proofKey;
      }
      const sdk = await initialize();
      const requirements = await sdk.buildPaymentRequirements({ scheme: 'exact', network: DEVNET,
        price: { amount: config.amountAtomic, asset: config.asset, extra: { decimals: config.assetDecimals } },
        payTo: config.merchantPayTo, maxTimeoutSeconds: 120, extra: { memo: memoFor(url) } });
      const paymentRequired = await sdk.createPaymentRequiredResponse(requirements,
        { url, description: 'Wallet transfer report', mimeType: 'application/json' });
      if (!header) {
        res.set('payment-required', encodePaymentRequiredHeader(paymentRequired));
        return res.status(402).json({ reasonCode: 'PAYMENT_REQUIRED' });
      }
      const matched = sdk.findMatchingRequirements(paymentRequired.accepts, payload);
      if (!matched || payload.resource?.url !== url) fail('PAYMENT_BINDING_MISMATCH');
      const quoted = { resourceUrl: url, requirements: payload.accepted, paymentRequired };
      const inspected = await inspectProof(header, quoted, config);
      const signed = { paymentHeader: header, messageHash: inspected.messageHash, payer: inspected.payer, signature: null, resourceUrl: url };
      const key = hash(`${url}\n${inspected.messageHash}`);
      let cached = await receiptStore.get(key);
      if (cached?.status === 'PENDING') {
        const observed = await gateway.reconcile(cached.response?.transaction, signed, quoted);
        if (observed.payment !== 'CONFIRMED') return res.status(409).json({ reasonCode: 'PAYMENT_PENDING' });
        cached = { ...cached, status: 'SETTLED', response: { success: true, network: DEVNET,
          transaction: observed.transaction, payer: inspected.payer, amount: config.amountAtomic } };
        await receiptStore.put(key, cached);
      }
      if (cached?.status === 'SETTLED') {
        if (cached.resourceUrl !== url || cached.messageHash !== inspected.messageHash || cached.payer !== inspected.payer) fail('PAYMENT_BINDING_MISMATCH');
        res.set('payment-response', encodePaymentResponseHeader(cached.response));
        return res.type('application/json').send(cached.body);
      }
      const verified = await sdk.verifyPayment(payload, matched);
      if (!verified.isValid) return res.status(402).json({ reasonCode: 'PAYMENT_REJECTED' });
      assertActiveReport();
      const parsed = new URL(url);
      reportWork = Promise.resolve().then(() => reportProvider({
        resourceRef: `urn:floww:report:${req.params.resourceId}`, wallet: parsed.searchParams.get('wallet'),
        windowStart: parsed.searchParams.get('start'), windowEnd: parsed.searchParams.get('end'),
        signal: reportController.signal,
      }));
      const report = await cancellableReport(reportWork, reportController.signal);
      assertActiveReport();
      const body = typeof report === 'string' ? report : JSON.stringify(report);
      if (!body || Buffer.byteLength(body) > MAX_BODY) fail('INVALID_REPORT');
      JSON.parse(body);
      assertActiveReport();
      const claimed = await receiptStore.claim(key);
      assertActiveReport();
      if (!claimed) return res.status(409).json({ reasonCode: 'PAYMENT_PENDING' });
      const pending = { status: 'PENDING', resourceUrl: url, messageHash: inspected.messageHash, payer: inspected.payer, body };
      await receiptStore.put(key, pending);
      assertActiveReport();
      // Async persistence is still pre-settlement work: cancellation during a
      // claim or pending write preserves that durable claim but cannot charge.
      // After this final guard, SDK settlement and its facts survive disconnect.
      cleanupReport();
      const settled = await sdk.settlePayment(payload, matched);
      await receiptStore.put(key, { ...pending, response: settled });
      const observed = await gateway.reconcile(settled.transaction, signed, quoted);
      if (!settled.success || observed.payment !== 'CONFIRMED' || settled.transaction !== observed.transaction || settled.network !== DEVNET) {
        return res.status(409).json({ reasonCode: 'SETTLEMENT_UNCONFIRMED' });
      }
      await receiptStore.put(key, { ...pending, status: 'SETTLED', response: settled });
      res.set('payment-response', encodePaymentResponseHeader(settled));
      return res.type('application/json').send(body);
    } catch (error) {
      const code = error instanceof GatewayError ? error.code : 'MERCHANT_UNAVAILABLE';
      if (res.destroyed) return;
      return res.status(code.startsWith('INVALID_') || code.startsWith('UNAPPROVED_') || code === 'PAYMENT_BINDING_MISMATCH' ? 400 : 503).json({ reasonCode: code });
    } finally {
      cleanupReport();
      // Cancellation can win the response race while a provider unwinds. Hold
      // both the temporary admission and shutdown lease until it really stops.
      await reportWork?.catch(() => {});
      if (activeProofKey) activeProofs.delete(activeProofKey);
      active--;
    }
  }));
  return { initialize };
}
