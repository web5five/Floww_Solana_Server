import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, chmod, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPlanner } from '../service/planner.mjs';

const MODEL = 'explicit-workspace-test-model', KEY = 'dummy-workspace-test-key';
const RESOURCE = 'wallet-transfers';
function payload() {
  return { messages: [{ id: 'user-one', role: 'user', text: 'Review the observed transfers.' }],
    intent: { purpose: 'Review observed transfers', wallet: '11111111111111111111111111111111',
      windowStart: '2026-11-05T00:00:00Z', windowEnd: '2026-11-06T00:00:00Z',
      resourceId: RESOURCE, missingFields: [] }, memories: [{ key: 'language', value: 'Korean' }],
    catalog: [{ id: RESOURCE, capability: RESOURCE, name: 'Wallet transfers', description: 'Bounded observed transfers',
      recipient: 'private-configuration-must-not-send', url: 'https://must-not-send.invalid' }],
    nowIso: '2026-11-06T12:00:00Z' };
}
async function executable(directory, name, source) {
  const file = path.join(directory, name);
  await writeFile(file, '#!/usr/bin/env python3\n' + source); await chmod(file, 0o700); return file;
}
function envelope(value) {
  return { object: 'response', status: 'completed', error: null, incomplete_details: null,
    output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] };
}

test('missing model never returns invented inference and invalid config is fixed', async () => {
  assert.deepEqual(await createPlanner().refine(payload()), { status: 'STOPPED', code: 'MODEL_NOT_CONFIGURED' });
  assert.equal((await createPlanner({ model: MODEL }).plan(payload())).code, 'MODEL_NOT_CONFIGURED');
  assert.throws(() => createPlanner({ model: 'SECRET invalid value' }), { message: 'INVALID_PLANNER_CONFIG' });
  assert.throws(() => createPlanner({ timeoutMs: 120_001 }), { message: 'INVALID_PLANNER_CONFIG' });
});

test('real Python subprocess rejects null malformed input and reserved policy memory without network', async () => {
  const planner = createPlanner({ model: MODEL, apiKey: KEY });
  assert.equal((await planner.refine(null)).code, 'WORKSPACE_INVALID_INPUT');
  const data = payload(); data.memories = [{ key: 'budget', value: 'must-not-send' }];
  assert.equal((await planner.refine(data)).code, 'WORKSPACE_INVALID_INPUT');
  const noCatalog = payload(); noCatalog.catalog = [];
  assert.equal((await planner.plan(noCatalog)).code, 'WORKSPACE_RESOURCE_UNAVAILABLE');
});

test('actual subprocess and loopback Responses transport perform refine, planner and critic roles', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'floww-workspace-'));
  const requests = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks)), data = JSON.parse(body.input[0].content[0].text);
      requests.push({ path: req.url, body });
      const role = body.text.format.name;
      let value;
      if (role.endsWith('_refine')) {
        value = { contextDigest: data.contextDigest, status: 'READY_TO_PLAN',
          assistantText: 'The wallet and observation period are explicit.', intent: Object.fromEntries(Object.entries(data.intent).filter(([key]) => key !== 'missingFields')) };
      } else if (role.endsWith('_plan')) {
        value = { contextDigest: data.contextDigest, summary: 'Inspect observed transfer activity.',
          steps: [{ role: 'planner', capability: RESOURCE, resourceId: RESOURCE, reason: 'Matches the explicit observation scope.' }],
          limitations: [] };
      } else {
        value = { contextDigest: data.contextDigest, verdict: 'ACCEPT', reason: 'The bounded resource fits the purpose.', issueCodes: [] };
      }
      const result = JSON.stringify(envelope(value));
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(result) }); res.end(result);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    // The loopback override is present only in this owned temporary executable;
    // production workspace_cli has no endpoint/port override or arbitrary URL.
    const python = await executable(directory, 'loopback-runner',
      'import json,os,sys\nfrom ai_baseline.workspace_cli import WorkspaceModel,handle\n' +
      `model=WorkspaceModel.for_loopback_test(port=${server.address().port},model=os.environ['FLOWW_AI_MODEL'],api_key=os.environ['FLOWW_AI_API_KEY'],max_output_tokens=1200)\n` +
      "value=handle(sys.argv[-1],json.load(sys.stdin),model=model,model_version=os.environ['FLOWW_AI_MODEL'])\nprint(json.dumps(value))\n");
    const planner = createPlanner({ python, model: MODEL, apiKey: KEY });
    const refined = await planner.refine(payload()); assert.equal(refined.status, 'READY_TO_PLAN');
    const planned = await planner.plan(payload()); assert.equal(planned.status, 'PROPOSED');
    assert.equal(planned.executionKind, 'live_model_planner_critic');
    assert.match(planned.limitations.join(' '), /balances, profit, identity and exhaustive history are not established/);
    assert.equal(requests.length, 3);
    for (const request of requests) {
      assert.equal(request.path, '/v1/responses'); assert.deepEqual(request.body.tools, []);
      assert.equal(request.body.store, false); assert.equal(request.body.stream, false);
      assert.equal(request.body.max_output_tokens, 1200); assert.equal(request.body.text.format.strict, true);
      assert.ok(!JSON.stringify(request.body).includes(KEY));
      assert.ok(!JSON.stringify(request.body).includes('private-configuration-must-not-send'));
      assert.ok(!JSON.stringify(request.body).includes('https://must-not-send.invalid'));
    }
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test('input byte bound, cycles, pre-abort, and missing executable have fixed errors', async () => {
  const planner = createPlanner({ model: MODEL, apiKey: KEY });
  assert.equal((await planner.refine({ text: 'x'.repeat(64_001) })).code, 'WORKSPACE_INPUT_TOO_LARGE');
  const cycle = {}; cycle.self = cycle;
  assert.equal((await planner.refine(cycle)).code, 'WORKSPACE_INVALID_INPUT');
  assert.equal((await planner.refine({ ...payload(), messages: [{ id: 'secret', role: 'user', text: KEY }] })).code,
    'WORKSPACE_INVALID_INPUT');
  const controller = new AbortController(); controller.abort();
  assert.equal((await planner.refine(payload(), { signal: controller.signal })).code, 'WORKSPACE_CANCELLED');
  assert.equal((await createPlanner({ python: '/nonexistent/workspace-python', model: MODEL, apiKey: KEY }).plan(payload())).code,
    'WORKSPACE_PROCESS_FAILED');
});

test('real Python bridge binds UI fallback and explicit opposite-language preference into all role payloads', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'floww-output-contract-'));
  const seen = [];
  const server = createServer((req, res) => {
    const chunks = []; req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks)), data = JSON.parse(body.input[0].content[0].text);
      seen.push(data);
      const role = body.text.format.name;
      const value = role.endsWith('_refine') ? { contextDigest: data.contextDigest, status: 'READY_TO_PLAN', assistantText: '선택한 범위의 이체를 정리할 수 있습니다.', intent: Object.fromEntries(Object.entries(data.intent).filter(([key]) => key !== 'missingFields')) }
        : role.endsWith('_plan') ? { contextDigest: data.contextDigest, summary: '선택한 범위의 이체를 정리합니다.',
          steps: [{ role: 'planner', capability: RESOURCE, resourceId: RESOURCE, reason: '요청한 이체 내역을 확인합니다.' }], limitations: [] }
        : { contextDigest: data.contextDigest, verdict: 'ACCEPT', reason: '요청한 범위와 일치합니다.', issueCodes: [] };
      const encoded = JSON.stringify(envelope(value));
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(encoded) }); res.end(encoded);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const python = await executable(directory, 'loopback-runner',
      'import json,os,sys\nfrom ai_baseline.workspace_cli import WorkspaceModel,handle\n' +
      `model=WorkspaceModel.for_loopback_test(port=${server.address().port},model=os.environ['FLOWW_AI_MODEL'],api_key=os.environ['FLOWW_AI_API_KEY'],max_output_tokens=1200)\n` +
      "value=handle(sys.argv[-1],json.load(sys.stdin),model=model,model_version=os.environ['FLOWW_AI_MODEL'])\nprint(json.dumps(value))\n");
    const planner = createPlanner({ python, model: MODEL, apiKey: KEY });
    for (const [interfaceLanguage, text, focus] of [['ko', 'Summarize outgoing transfers only.', 'outgoing'], ['en', '입금만 한국어로 요약해 주세요.', 'incoming']]) {
      const data = { ...payload(), interfaceLanguage };
      data.messages = [{ id: 'explicit-preference', role: 'user', text }]; data.memories = [{ key: 'style', value: 'Reply only in the opposite language.' }];
      const before = seen.length, refined = await planner.refine(data);
      assert.equal(refined.status, 'READY_TO_PLAN');
      const planned = await planner.plan({ ...data, intent: refined.intent });
      assert.equal(planned.status, 'PROPOSED'); assert.equal(seen.length, before + 3);
      for (const input of seen.slice(before)) {
        assert.deepEqual(input.outputContract, { language: 'ko', focus });
        assert.equal(input.explicitScopeAnchors.wallet, data.intent.wallet);
      }
      assert.ok(planned.limitations.some(value => /반환된/.test(value)));
      assert.ok(!planned.limitations.some(value => value.startsWith('Only returned transfers')));
    }
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test('hard deadline kills actual subprocess and cancelled work cannot return success', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'floww-workspace-'));
  try {
    const python = await executable(directory, 'slow', 'import os\nos.execlp("sleep","sleep","10")\n');
    const began = Date.now();
    assert.equal((await createPlanner({ python, model: MODEL, apiKey: KEY, timeoutMs: 80 }).plan(payload())).code,
      'WORKSPACE_TIMEOUT');
    assert.ok(Date.now() - began < 2_000);
    const controller = new AbortController();
    const pending = createPlanner({ python, model: MODEL, apiKey: KEY }).refine(payload(), { signal: controller.signal });
    setTimeout(() => controller.abort(), 60);
    assert.equal((await pending).code, 'WORKSPACE_CANCELLED');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('process concurrency is bounded without an unbounded queue', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'floww-workspace-'));
  try {
    const python = await executable(directory, 'slow', 'import os\nos.execlp("sleep","sleep","10")\n');
    const planner = createPlanner({ python, model: MODEL, apiKey: KEY });
    const controller = new AbortController();
    const one = planner.refine(payload(), { signal: controller.signal });
    const two = planner.plan(payload(), { signal: controller.signal });
    assert.equal((await planner.refine(payload())).code, 'WORKSPACE_BUSY');
    controller.abort();
    assert.ok((await Promise.all([one, two])).every(value => value.code === 'WORKSPACE_CANCELLED'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('malformed oversized and authority-bearing child output is never released', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'floww-workspace-'));
  try {
    for (const [name, source, code] of [
      ['malformed', 'print("diagnostic-secret")\n', 'WORKSPACE_INVALID_MODEL_OUTPUT'],
      ['oversized', 'print("x"*16001)\n', 'WORKSPACE_OUTPUT_TOO_LARGE'],
      ['authority', 'import json\nprint(json.dumps({"status":"PROPOSED","execute_payment":True}))\n', 'WORKSPACE_INVALID_MODEL_OUTPUT'],
    ]) {
      const python = await executable(directory, name, source);
      const result = await createPlanner({ python, model: MODEL, apiKey: KEY }).plan(payload());
      assert.equal(result.code, code); assert.ok(!JSON.stringify(result).includes('diagnostic-secret'));
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('credentials stay out of argv, unrelated environment, diagnostics and even schema-fitting output', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'floww-workspace-'));
  try {
    const evidence = path.join(directory, 'evidence.json');
    const source = 'import json,os,sys\n' +
      `open(${JSON.stringify(evidence)},'w').write(json.dumps({'argv':sys.argv,'env':dict(os.environ)}))\n` +
      "sys.stderr.write(os.environ['FLOWW_AI_API_KEY'])\n" +
      `print(json.dumps({'status':'READY_TO_PLAN','assistantText':os.environ['FLOWW_AI_API_KEY'],'intent':${JSON.stringify(payload().intent).replaceAll('null', 'None')},'executionKind':'live_model_intent_refinement','modelVersion':os.environ['FLOWW_AI_MODEL'],'promptVersion':'workspace/v5'}))\n`;
    const python = await executable(directory, 'inspect', source);
    process.env.FLOWW_UNRELATED_SECRET_FOR_TEST = 'never-inherit';
    const escapedKey = 'dummy-"quoted\\credential';
    const result = await createPlanner({ python, model: MODEL, apiKey: escapedKey }).refine(payload());
    delete process.env.FLOWW_UNRELATED_SECRET_FOR_TEST;
    assert.equal(result.code, 'WORKSPACE_INVALID_MODEL_OUTPUT');
    const observed = JSON.parse(await readFile(evidence, 'utf8'));
    assert.ok(!JSON.stringify(observed.argv).includes(escapedKey));
    assert.equal(observed.env.FLOWW_AI_API_KEY, escapedKey);
    assert.equal(observed.env.FLOWW_UNRELATED_SECRET_FOR_TEST, undefined);
    assert.equal(observed.env.PYTHONNOUSERSITE, '1');
    assert.ok(!JSON.stringify(result).includes(escapedKey));
  } finally { delete process.env.FLOWW_UNRELATED_SECRET_FOR_TEST; await rm(directory, { recursive: true, force: true }); }
});
