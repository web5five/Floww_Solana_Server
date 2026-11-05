import { randomUUID } from 'node:crypto';
import { getBase58Encoder } from '@solana/kit';
import { atomic, DEVNET, exact, fail, isAddress, iso } from './config.mjs';
import { digest } from './store.mjs';

export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
export const termsHash = quote => digest(canonical({
  resourceUrl: quote.resourceUrl, x402Version: quote.paymentRequired?.x402Version,
  resource: quote.paymentRequired?.resource, requirements: quote.requirements,
}));

function time(value) {
  const result = iso(value);
  if (result.slice(0, 19) !== value.slice(0, 19)) fail('INVALID_TIME');
  return result;
}
export function makeTask(body, owner, now = Date.now()) {
  exact(body, ['purpose', 'wallet', 'windowStart', 'windowEnd']);
  if (typeof body.purpose !== 'string' || !body.purpose.trim() || body.purpose.length > 2_000 ||
      /[\x00-\x08\x0b-\x1f\x7f]/.test(body.purpose) || !isAddress(body.wallet)) fail('INVALID_TASK');
  const windowStart = time(body.windowStart), windowEnd = time(body.windowEnd);
  const start = Date.parse(windowStart), end = Date.parse(windowEnd);
  if (!(start < end && end <= now && end - start <= 7 * 86_400_000)) fail('INVALID_ANALYTICS_SCOPE');
  return {
    id: randomUUID(), owner, purpose: body.purpose.trim().normalize('NFC'),
    wallet: body.wallet, windowStart, windowEnd,
    createdAt: new Date(now).toISOString(), policy: 'PENDING', payment: 'NOT_STARTED',
    delivery: 'NOT_STARTED', quote: null, approval: null, proposal: null, result: null,
    transaction: null, events: [], reasonCode: 'QUOTE_REQUIRED', nextAction: 'QUOTE',
    operation: null,
  };
}
export function resourceUrl(task, config) {
  const url = new URL(config.merchantBaseUrl + '/' + task.id);
  url.search = new URLSearchParams({ wallet: task.wallet, start: task.windowStart, end: task.windowEnd }).toString();
  return url.href;
}
export function validateQuote(quote, expectedUrl, config) {
  const r = quote?.requirements, p = quote?.paymentRequired;
  if (!r || !p || p.x402Version !== 2 || quote.resourceUrl !== expectedUrl ||
      p.resource?.url !== expectedUrl || !Array.isArray(p.accepts) || p.accepts.length !== 1 ||
      canonical(p.accepts[0]) !== canonical(r) || r.scheme !== 'exact' || r.network !== DEVNET ||
      r.network !== config.network || r.asset !== config.asset || r.payTo !== config.merchantPayTo ||
      r.amount !== config.amountAtomic || atomic(r.amount) <= 0n || atomic(r.amount) > atomic(config.maxPaymentAtomic) ||
      !Number.isInteger(r.maxTimeoutSeconds) || r.maxTimeoutSeconds < 1 || r.maxTimeoutSeconds > 300 ||
      !isAddress(r.extra?.feePayer)) fail('UNAPPROVED_PAYMENT_TERMS', 409);
  return quote;
}
export function attachQuote(task, quoteData, config, payer, now) {
  const expiresAt = new Date(now + config.quoteTtlMs).toISOString();
  const hash = digest(canonical({ terms: termsHash(quoteData), taskId: task.id,
    wallet: task.wallet, windowStart: task.windowStart, windowEnd: task.windowEnd, payer, expiresAt }));
  task.quoteData = quoteData;
  task.quote = { hash, amountAtomic: quoteData.requirements.amount, asset: quoteData.requirements.asset,
    assetDecimals: config.assetDecimals, network: config.network, recipient: quoteData.requirements.payTo,
    payer, resourceUrl: quoteData.resourceUrl, expiresAt };
  const resourceRef = 'urn:floww:report:' + task.id;
  task.aiSnapshot = {
    context: { owner_ref: task.owner, task_ref: task.id, task_version: '1',
      mandate_ref: 'mandate_' + task.id, mandate_version: '1', purpose: task.purpose, valid_until: expiresAt },
    candidate: { candidate_id: resourceRef, merchant_ref: 'floww:merchant', resource_ref: resourceRef,
      requirements_ref: hash, amount_atomic: task.quote.amountAtomic, asset_ref: config.asset,
      network_ref: config.network, recipient_ref: config.merchantPayTo,
      description: 'Transfer report for the explicitly selected wallet and time window.', valid_until: expiresAt },
    request: { task_ref: task.id, task_version: '1', resource_ref: resourceRef,
      wallet: task.wallet, data_network: config.network, window_start: task.windowStart, window_end: task.windowEnd },
    selectionMode: 'direct_resource',
  };
  task.policy = 'PENDING'; task.approval = null; task.proposal = null;
  task.reasonCode = 'APPROVAL_REQUIRED'; task.nextAction = 'APPROVE';
}
export function approve(task, body, config, payer, now) {
  exact(body, ['quoteHash', 'budgetAtomic', 'expiresAt', 'acknowledge', 'allowedRecipient', 'asset', 'network']);
  if (task.payment !== 'NOT_STARTED' || task.signedData || task.attemptRef || task.operation) fail('EXECUTION_ALREADY_CLAIMED', 409);
  if (!task.quote || !task.proposal || task.quote.hash !== body.quoteHash) fail('QUOTE_REQUIRED', 409);
  if (task.quote.payer !== payer || !isAddress(payer)) fail('PAYER_CHANGED', 409);
  if (body.acknowledge !== true) fail('EXPLICIT_APPROVAL_REQUIRED');
  if ((body.allowedRecipient !== undefined && body.allowedRecipient !== task.quote.recipient) ||
      (body.asset !== undefined && body.asset !== task.quote.asset) ||
      (body.network !== undefined && body.network !== task.quote.network)) fail('UNAUTHORIZED_PAYMENT_TERMS', 403);
  const cap = atomic(body.budgetAtomic), amount = atomic(task.quote.amountAtomic);
  if (cap < amount || cap > atomic(config.maxPaymentAtomic)) fail('BUDGET_DENIED', 403);
  const expiresAt = time(body.expiresAt);
  if (Date.parse(expiresAt) <= now || Date.parse(task.quote.expiresAt) <= now ||
      Date.parse(expiresAt) > Date.parse(task.quote.expiresAt)) fail('APPROVAL_EXPIRED', 409);
  task.approval = { id: randomUUID(), quoteHash: task.quote.hash, budgetAtomic: body.budgetAtomic,
    expiresAt, payer, approvedAt: new Date(now).toISOString(), revoked: false };
  task.policy = 'ALLOW'; task.reasonCode = 'APPROVED'; task.nextAction = 'EXECUTE';
}
export function assertApproval(task, config, payer, now) {
  const a = task.approval, q = task.quote;
  if (!a || !q || a.revoked || task.policy !== 'ALLOW' || a.quoteHash !== q.hash) fail('APPROVAL_REQUIRED', 403);
  if (Date.parse(a.expiresAt) <= now || Date.parse(q.expiresAt) <= now) fail('APPROVAL_EXPIRED', 403);
  if (a.payer !== payer || q.payer !== payer || !isAddress(payer)) fail('PAYER_CHANGED', 403);
  if (atomic(a.budgetAtomic) < atomic(q.amountAtomic) || atomic(q.amountAtomic) > atomic(config.maxPaymentAtomic)) fail('BUDGET_DENIED', 403);
  validateQuote(task.quoteData, resourceUrl(task, config), config);
}
export function signature(value) {
  try { return typeof value === 'string' && value.length <= 88 && getBase58Encoder().encode(value).length === 64; }
  catch { return false; }
}
export function publicTask(task) {
  return Object.fromEntries(['id', 'revision', 'purpose', 'wallet', 'windowStart', 'windowEnd', 'createdAt',
    'policy', 'payment', 'delivery', 'quote', 'approval', 'proposal', 'transaction', 'events',
    'result', 'reasonCode', 'nextAction'].map(key => [key, task[key] ?? null]));
}
