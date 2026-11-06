import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAiBridge } from '../service/ai.mjs';

function snapshot() {
  const now = Date.now(), iso = t => new Date(t).toISOString();
  const network = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
  return {
    context: { owner_ref: 'owner-one', task_ref: 'task-one', task_version: '1',
      mandate_ref: 'mandate-one', mandate_version: '1', purpose: 'Review wallet transfers', valid_until: iso(now + 300_000) },
    candidate: { candidate_id: 'report-one', merchant_ref: 'merchant-one', resource_ref: 'resource-one',
      requirements_ref: 'quote-one', amount_atomic: '1000', asset_ref: 'asset-one', network_ref: network,
      recipient_ref: 'recipient-one', description: 'Selected wallet transfer report', valid_until: iso(now + 300_000) },
    request: { task_ref: 'task-one', task_version: '1', resource_ref: 'resource-one', wallet: 'wallet-one',
      data_network: network, window_start: iso(now - 3_600_000), window_end: iso(now - 60_000) },
  };
}
function bodyFor(input) {
  return JSON.stringify({ schema_version: 'analytics-reference/v1', resource_ref: input.request.resource_ref,
    wallet: input.request.wallet, data_network: input.request.data_network, window_start: input.request.window_start,
    window_end: input.request.window_end, generated_at: new Date().toISOString(), data_as_of: input.request.window_end,
    coverage: { complete: false, pagination_complete: true }, is_synthetic: false,
    source_refs: ['solana:devnet:rpc'], transfers: [] });
}
async function approved(bridge) {
  const input = snapshot(), proposal = await bridge.propose(input);
  assert.equal(proposal.status, 'PROPOSED');
  return { ...input, proposalRef: proposal.proposal_ref, attemptRef: 'attempt-one', settlementRef: 'settlement-one',
    deliveryRef: 'delivery-one', policy: 'ALLOW', payment: 'CONFIRMED', fulfillment: 'COMPLETED', body: bodyFor(input) };
}

test('real Python subprocess produces a validated explicit resource proposal', async () => {
  const result = await createAiBridge().propose(snapshot());
  assert.equal(result.status, 'PROPOSED'); assert.equal(result.code, 'BACKEND_REVIEW_REQUIRED');
  assert.match(result.proposal_ref, /^[a-f0-9-]{36}$/);
  assert.equal(result.execution_kind, 'explicit_resource_selection');
});
test('real Python subprocess validates delivered report and renders safe HTML/Markdown', async () => {
  const bridge = createAiBridge(), result = await bridge.consume(await approved(bridge));
  assert.equal(result.status, 'EVIDENCE_READY');
  assert.equal(result.answer.is_synthetic, false);
  assert.equal(result.answer.complete, false);
  assert.match(result.html, /incomplete coverage cannot establish no activity/);
  assert.match(result.markdown, /Partial coverage/);
  assert.equal(result.body, undefined);
});
test('real Python subprocess presents Korean purpose and focused prose without changing exact report facts', async () => {
  const bridge = createAiBridge(), input = snapshot();
  input.context.purpose = '입금만 한국어로 요약해줘';
  const proposal = await bridge.propose(input);
  assert.equal(proposal.status, 'PROPOSED');
  const raw = { ...input, proposalRef: proposal.proposal_ref, attemptRef: 'attempt-one', settlementRef: 'settlement-one',
    deliveryRef: 'delivery-one', policy: 'ALLOW', payment: 'CONFIRMED', fulfillment: 'COMPLETED' };
  const body = JSON.parse(bodyFor(input));
  body.transfers = [
    { record_id: 'incoming', source_ref: body.source_refs[0], transaction_ref: 'tx-one', event_index: 0,
      timestamp: new Date(Date.parse(input.request.window_start) + 1_000).toISOString(), asset_ref: 'mint-one',
      decimals: 6, amount_base_units: '9007199254740993123456789', from_wallet: 'counterparty', to_wallet: input.request.wallet },
    { record_id: 'outgoing', source_ref: body.source_refs[0], transaction_ref: 'tx-two', event_index: 0,
      timestamp: new Date(Date.parse(input.request.window_start) + 2_000).toISOString(), asset_ref: 'mint-two',
      decimals: 0, amount_base_units: '7', from_wallet: input.request.wallet, to_wallet: 'counterparty' },
  ];
  raw.body = JSON.stringify(body);
  const result = await bridge.consume(raw);
  assert.equal(result.status, 'EVIDENCE_READY');
  assert.equal(result.answer.transfer_count, 2);
  assert.equal(result.answer.complete, false);
  assert.equal(result.answer.totals.length, 2);
  assert.equal(result.answer.totals[0].amount_base_units, '9007199254740993123456789');
  assert.equal(result.answer.totals[0].amount_display, '9007199254740993123.456789');
  assert.match(result.answer.answer_text, /입금 \(in\): 1건, 9007199254740993123\.456789 단위/);
  assert.doesNotMatch(result.answer.answer_text, /출금 \(out\)/);
  assert.deepEqual(result.answer.evidence_refs, ['delivery-one', 'delivery-one#transfer-incoming', 'delivery-one#transfer-outgoing']);
  for (const output of [result.markdown, result.html]) {
    assert.ok(output.includes('9007199254740993123.456789'));
    assert.ok(output.includes('mint-two'));
    assert.ok(output.includes('delivery-one#transfer-outgoing'));
  }
  assert.match(result.html, /<html lang="ko">/);
  assert.match(result.markdown, /# 지갑 전송 보고서/);
});
test('real Python subprocess honors English cue and escapes Korean purpose markup in every output', async () => {
  const bridge = createAiBridge(), input = snapshot();
  const purpose = '건수만 in English\n```\n# injected\n```\n<script>alert(1)</script> [x](javascript:x)';
  input.context.purpose = purpose;
  const proposal = await bridge.propose(input);
  const result = await bridge.consume({ ...input, proposalRef: proposal.proposal_ref, attemptRef: 'attempt-one',
    settlementRef: 'settlement-one', deliveryRef: 'delivery-one', policy: 'ALLOW', payment: 'CONFIRMED',
    fulfillment: 'COMPLETED', body: bodyFor(input) });
  assert.equal(result.status, 'EVIDENCE_READY');
  assert.match(result.answer.answer_text, /Returned transfers: 0/);
  assert.match(result.answer.answer_text, /incomplete coverage cannot establish no activity/);
  assert.ok(result.answer.answer_text.includes(purpose));
  assert.match(result.html, /<html lang="en">/);
  assert.doesNotMatch(result.html, /<script>/);
  assert.match(result.html, /&lt;script&gt;/);
  assert.ok(result.markdown.includes('````text\n' + result.answer.answer_text + '\n````'));
});
test('missing authorization and payment states cannot default to success', async () => {
  const bridge = createAiBridge(), input = await approved(bridge);
  for (const field of ['policy', 'payment', 'fulfillment']) {
    const invalid = { ...input }; delete invalid[field];
    const result = await bridge.consume(invalid);
    assert.notEqual(result.status, 'EVIDENCE_READY'); assert.equal(result.answer, undefined);
  }
});
test('DENY, UNKNOWN and paid-undelivered states preserve the existing gate', async () => {
  const bridge = createAiBridge(), input = await approved(bridge);
  for (const [change, code] of [[{ policy: 'DENY' }, 'POLICY_DENIED'],
    [{ payment: 'UNKNOWN' }, 'PAYMENT_RECONCILIATION_REQUIRED'],
    [{ fulfillment: 'FAILED' }, 'PAID_RESOURCE_UNDELIVERED']]) {
    const result = await bridge.consume({ ...input, ...change });
    assert.equal(result.code, code); assert.equal(result.answer, undefined);
  }
});
test('mismatched resource, stale context and malformed report fail closed', async () => {
  const bridge = createAiBridge(), input = await approved(bridge);
  const report = JSON.parse(input.body); report.wallet = 'other-wallet';
  assert.equal((await bridge.consume({ ...input, body: JSON.stringify(report) })).code, 'REPORT_SCOPE_MISMATCH');
  assert.equal((await bridge.consume({ ...input, currentContext: { ...input.context, task_version: '2' } })).code, 'STALE_CONTEXT');
  const result = await bridge.consume({ ...input, body: 'SECRET broken report' });
  assert.equal(result.status, 'STOPPED'); assert.ok(!JSON.stringify(result).includes('SECRET'));
});
test('model mode requires explicit configuration and unknown mode is rejected', async () => {
  const bridge = createAiBridge();
  assert.equal((await bridge.propose({ ...snapshot(), selectionMode: 'model' })).code, 'MODEL_NOT_CONFIGURED');
  assert.equal((await bridge.propose({ ...snapshot(), selectionMode: 'arbitrary' })).code, 'INVALID_SELECTION_MODE');
});
test('input bounds, cycle, pre-abort and missing executable return fixed diagnostics', async () => {
  const bridge = createAiBridge(), cycle = {}; cycle.self = cycle;
  assert.equal((await bridge.propose({ body: 'x'.repeat(600_001) })).code, 'AI_INPUT_TOO_LARGE');
  assert.equal((await bridge.propose(cycle)).code, 'AI_INVALID_INPUT');
  const controller = new AbortController(); controller.abort();
  assert.equal((await bridge.propose(snapshot(), { signal: controller.signal })).code, 'AI_CANCELLED');
  assert.equal((await createAiBridge({ python: '/nonexistent/floww-python' }).propose(snapshot())).code, 'AI_PROCESS_FAILED');
});
test('total deadline kills an actual subprocess and discards its diagnostics', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'floww-ai-'));
  try {
    const executable = path.join(directory, 'slow');
    await writeFile(executable, '#!/bin/sh\nexec sleep 10\n'); await chmod(executable, 0o700);
    const begin = Date.now();
    const result = await createAiBridge({ python: executable, timeoutMs: 80 }).propose(snapshot());
    assert.equal(result.code, 'AI_TIMEOUT'); assert.ok(Date.now() - begin < 2_000);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('secret is passed only through a minimized environment, never argv or returned stderr', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'floww-ai-'));
  try {
    const executable = path.join(directory, 'inspect');
    const evidence = path.join(directory, 'evidence');
    const source = '#!/usr/bin/env python3\nimport json,os,sys\n' +
      `open(${JSON.stringify(evidence)},'w').write(json.dumps({'argv':sys.argv,'env':dict(os.environ)}))\n` +
      'sys.stderr.write(os.environ.get("FLOWW_AI_API_KEY", ""))\n' +
      'print(json.dumps({"status":"STOPPED","code":"INSPECTION_COMPLETE"}))\n';
    await writeFile(executable, source); await chmod(executable, 0o700);
    process.env.FLOWW_UNRELATED_SECRET_FOR_TEST = 'must-not-inherit';
    const result = await createAiBridge({ python: executable, model: 'explicit-model', apiKey: 'dummy-secret-value' }).propose(snapshot());
    delete process.env.FLOWW_UNRELATED_SECRET_FOR_TEST;
    const observed = JSON.parse(await readFile(evidence, 'utf8'));
    assert.ok(!JSON.stringify(observed.argv).includes('dummy-secret-value'));
    assert.equal(observed.env.FLOWW_AI_API_KEY, 'dummy-secret-value');
    assert.equal(observed.env.FLOWW_UNRELATED_SECRET_FOR_TEST, undefined);
    assert.ok(!JSON.stringify(result).includes('dummy-secret-value'));
  } finally { delete process.env.FLOWW_UNRELATED_SECRET_FOR_TEST; await rm(directory, { recursive: true, force: true }); }
});
