import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { getBase58Decoder } from '@solana/kit';
import { loadConfig } from '../service/config.mjs';
import { makeTask, attachQuote, approve, assertApproval, termsHash, validateQuote, publicTask, resourceUrl } from '../service/policy.mjs';

const wallet = () => getBase58Decoder().decode(generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).subarray(-32));
const now = Date.UTC(2026, 10, 5, 12);
function fixture() {
  const payer = wallet(), cfg = { ...loadConfig({ MERCHANT_PAY_TO: wallet() }), paymentEnabled: true };
  const t = makeTask({ purpose: 'Wallet transfers', wallet: wallet(), windowStart: '2026-11-04T00:00:00.000Z', windowEnd: '2026-11-05T00:00:00.000Z' }, wallet(), now);
  const url = resourceUrl(t, cfg);
  const requirements = { scheme: 'exact', network: cfg.network, amount: cfg.amountAtomic, asset: cfg.asset, payTo: cfg.merchantPayTo, maxTimeoutSeconds: 120, extra: { feePayer: wallet() } };
  const q = { resourceUrl: url, requirements, paymentRequired: { x402Version: 2, resource: { url }, accepts: [requirements] } };
  attachQuote(t, q, cfg, payer, now); t.proposal = { ref: 'proposal-1' };
  const body = { quoteHash: t.quote.hash, budgetAtomic: '1000', expiresAt: new Date(now + 60_000).toISOString(), acknowledge: true };
  return { t, q, cfg, payer, body, url };
}
test('explicit exact approval allows only its quoted payer and active time', () => {
  const { t, cfg, payer, body } = fixture(); approve(t, body, cfg, payer, now); assertApproval(t, cfg, payer, now + 1);
  assert.throws(() => assertApproval(t, cfg, wallet(), now), /PAYER_CHANGED/);
  assert.throws(() => assertApproval(t, cfg, payer, now + 60_000), /APPROVAL_EXPIRED/);
  t.approval.revoked = true; assert.throws(() => assertApproval(t, cfg, payer, now), /APPROVAL_REQUIRED/);
});
test('cap, acknowledgement, terms and replacement execution fail closed', () => {
  const { t, cfg, payer, body } = fixture();
  assert.throws(() => approve(t, { ...body, budgetAtomic: '999' }, cfg, payer, now), /BUDGET_DENIED/);
  assert.throws(() => approve(t, { ...body, allowedRecipient: wallet() }, cfg, payer, now), /UNAUTHORIZED_PAYMENT_TERMS/);
  assert.throws(() => approve(t, { ...body, acknowledge: false }, cfg, payer, now), /EXPLICIT_APPROVAL_REQUIRED/);
  assert.throws(() => approve(t, { ...body, budgetAtomic: '1e3' }, cfg, payer, now), /INVALID_AMOUNT/);
  t.attemptRef = 'already-claimed'; assert.throws(() => approve(t, body, cfg, payer, now), /EXECUTION_ALREADY_CLAIMED/);
});
test('quote hash is stable by object ordering and rejects changed network, price or resource', () => {
  const { q, cfg, url } = fixture(); validateQuote(q, url, cfg);
  assert.equal(termsHash(q), termsHash({ ...q, requirements: Object.fromEntries(Object.entries(q.requirements).reverse()) }));
  for (const changed of [
    { ...q, resourceUrl: url + 'other' },
    { ...q, requirements: { ...q.requirements, network: 'solana:mainnet' } },
    { ...q, requirements: { ...q.requirements, amount: '1001' } },
  ]) assert.throws(() => validateQuote(changed, url, cfg), /UNAPPROVED_PAYMENT_TERMS/);
});
test('invalid scopes and authority injection are rejected; private fields excluded', () => {
  const { t } = fixture();
  const body = { purpose: 'transfers', wallet: wallet(), windowStart: '2026-10-01T00:00:00Z', windowEnd: '2026-11-01T00:00:00Z' };
  assert.throws(() => makeTask(body, wallet(), now), /INVALID_ANALYTICS_SCOPE/);
  assert.throws(() => makeTask({ ...body, owner: wallet() }, wallet(), now), /INVALID_REQUEST/);
  assert.throws(() => makeTask({ ...body, windowStart: '2026-02-30T00:00:00Z' }, wallet(), now), /INVALID_TIME/);
  t.signedData = { paymentHeader: 'private-proof' }; t.deliveredBody = 'private-body'; t.operation = { id: 'private' };
  const snapshot = JSON.stringify(publicTask(t));
  for (const value of ['private-proof', 'private-body', 'aiSnapshot', 'quoteData', 'signedData', 'operation']) assert.ok(!snapshot.includes(value));
});

test('server workspace context binds the quote and cannot be inserted through client task input', () => {
  const f = fixture();
  const body = { purpose: f.t.purpose, wallet: f.t.wallet, windowStart: f.t.windowStart, windowEnd: f.t.windowEnd };
  const context = { conversationId: 'conversation-1', planHash: 'a'.repeat(64), intentRevision: 2,
    resourceId: 'wallet-transfers', mandateId: 'mandate-1', mandateVersion: 1 };
  assert.throws(() => makeTask({ ...body, workspaceContext: context }, f.t.owner, now), /INVALID_REQUEST/);
  for (const invalid of [{ ...context, intentRevision: 0 }, { ...context, planHash: 'fake' },
    { ...context, mandateVersion: null }, { ...context, arbitraryAuthority: true }]) {
    assert.throws(() => makeTask(body, f.t.owner, now, invalid), /INVALID_WORKSPACE_CONTEXT|INVALID_REQUEST/);
  }
  const task = makeTask(body, f.t.owner, now, context); task.id = f.t.id;
  attachQuote(task, f.q, f.cfg, f.payer, now); task.proposal = { ref: 'workspace-proposal' };
  assert.notEqual(task.quote.hash, f.t.quote.hash);
  const approval = { ...f.body, quoteHash: task.quote.hash };
  approve(task, approval, f.cfg, f.payer, now); assertApproval(task, f.cfg, f.payer, now + 1);
  task.workspaceContext.intentRevision++;
  assert.throws(() => assertApproval(task, f.cfg, f.payer, now + 1), /QUOTE_CHANGED/);
  assert.throws(() => approve(task, approval, f.cfg, f.payer, now), /QUOTE_CHANGED/);
  assert.deepEqual(publicTask(task).workspaceContext, task.workspaceContext);
});
