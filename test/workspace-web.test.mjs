import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const base = new URL('../service/web/', import.meta.url);
const html = await readFile(new URL('index.html', base), 'utf8');
const client = await readFile(new URL('workspace-client.js', base), 'utf8');
const taskClient = await readFile(new URL('app.js', base), 'utf8');
const A = '11111111111111111111111111111111', B = '11111111111111111111111111111112';
const TASK_A = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', TASK_B = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const CONVERSATION_A = 'cccccccc-cccc-4ccc-cccc-cccccccccccc', CONVERSATION_B = 'dddddddd-dddd-4ddd-dddd-dddddddddddd';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const response = (body, status = 200) => ({ status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body) });
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
async function until(check) {
  for (let i = 0; i < 100; i++) { if (check()) return; await new Promise(resolve => setImmediate(resolve)); }
  assert.ok(check(), 'scripted UI action did not reach the expected boundary');
}

// Execute the unmodified browser clients with inert DOM primitives. These tests
// exercise request ordering, public events and visible text; they do not assert
// implementation source strings, claim layout coverage, or contact a network.
function harness(source, fetcher) {
  const nodes = [], ids = new Map(), intervals = new Map(), windowEvents = new Map(); let timerId = 0;
  class Node {
    constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.attributes = {};
      this.listeners = new Map(); this.value = ''; this.checked = false; this.disabled = false; this.hidden = false; this.ownText = ''; nodes.push(this); }
    set textContent(value) { this.ownText = String(value ?? ''); this.children = []; }
    get textContent() { return this.ownText + this.children.map(child => typeof child === 'string' ? child : child.textContent).join(''); }
    append(...children) { for (const child of children) { if (child && typeof child === 'object') child.parentNode = this; this.children.push(child); } }
    replaceChildren(...children) { this.children = []; this.ownText = ''; this.append(...children); }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    removeAttribute(key) { delete this.attributes[key]; }
    addEventListener(type, fn) { const values = this.listeners.get(type) ?? []; values.push(fn); this.listeners.set(type, values); }
    reportValidity() { return true; }
    reset() { const walk = node => { if (['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName)) {
      node.value = node.defaultValue ?? ''; node.checked = node.defaultChecked ?? false;
    } node.children.forEach(child => { if (typeof child === 'object') walk(child); }); }; walk(this); }
    focus() {}
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(node => node !== this); }
    async trigger(type) { await Promise.all((this.listeners.get(type) ?? []).map(fn => fn({ type, preventDefault() {} }))); }
    set innerHTML(_) { throw new Error('Raw HTML insertion is not supported by this security harness'); }
  }
  const root = new Node('document'), stack = [root], voids = new Set(['meta', 'link', 'input', 'br', 'hr', 'img', 'path', 'rect']);
  for (const match of html.matchAll(/<(\/?)([a-z][a-z0-9-]*)\b([^>]*)>/gi)) {
    const [, closing, tag, attrs] = match;
    if (closing) {
      const index = stack.findLastIndex(node => node.tagName === tag.toUpperCase());
      if (index > 0) stack.length = index;
      continue;
    }
    const node = new Node(tag); stack.at(-1).append(node);
    for (const attr of attrs.matchAll(/([\w-]+)(?:="([^"]*)")?/g)) {
      const [, key, value = ''] = attr;
      if (key === 'id') { node.id = value; assert.ok(!ids.has(value), 'duplicate HTML id'); ids.set(value, node); }
      if (key === 'class') node.className = value;
      if (key.startsWith('data-')) node.dataset[key.slice(5)] = value;
      if (key === 'value') node.value = node.defaultValue = value;
      if (key === 'checked') node.checked = node.defaultChecked = true;
      if (key === 'hidden') node.hidden = true;
    }
    if (!voids.has(tag.toLowerCase()) && !attrs.trim().endsWith('/')) stack.push(node);
  }
  const page = node => { for (let p = node; p; p = p.parentNode) if (p.dataset.page) return p.dataset.page; return null; };
  const document = { hidden: false, body: nodes.find(node => node.tagName === 'BODY'),
    getElementById: id => ids.get(id) ?? null, createElement: tag => new Node(tag),
    querySelectorAll: selector => {
      if (selector === '[data-page]') return nodes.filter(node => node.dataset.page);
      if (selector === '[data-view]' || selector === '.shell-nav [data-view]') return nodes.filter(node => node.dataset.view);
      if (selector === '[data-go]') return nodes.filter(node => node.dataset.go);
      if (selector === '.task-item') return nodes.filter(node => node.className?.split(' ').includes('task-item'));
      if (selector.includes('[data-page]:not')) return nodes.filter(node => page(node) && page(node) !== 'tasks' &&
        (selector.includes('button') ? node.tagName === 'BUTTON' && !node.dataset.go : ['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName)));
      if (selector.startsWith('#workspace form')) return nodes.filter(node => page(node) === 'tasks' && ['INPUT', 'TEXTAREA'].includes(node.tagName));
      throw new Error('Unsupported selector in test harness: ' + selector);
    } };
  class Event { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } }
  const window = { scrollTo() {}, addEventListener(type, fn) { const values = windowEvents.get(type) ?? []; values.push(fn); windowEvents.set(type, values); },
    dispatchEvent(event) { for (const fn of windowEvents.get(event.type) ?? []) fn(event); return true; } };
  const calls = [];
  const context = { document, window, CustomEvent: Event, Option: function Option(text, value) { const n = new Node('option'); n.textContent = text; n.value = value; return n; },
    fetch: async (url, options) => { const call = { url: String(url), ...options, body: options?.body ? JSON.parse(options.body) : undefined }; calls.push(call); return fetcher(call); },
    setInterval(fn) { const id = ++timerId; intervals.set(id, fn); return id; }, clearInterval(id) { intervals.delete(id); },
    setTimeout() { return ++timerId; }, clearTimeout() {}, AbortController, URL, URLSearchParams, Intl, Date,
    TextEncoder, Uint8Array, Blob, btoa, crypto: globalThis.crypto };
  vm.runInNewContext(source, context, { filename: 'browser-client-under-test.js' });
  return { document, window, nodes, calls, intervals, get: id => ids.get(id),
    session(wallet) { window.dispatchEvent(new Event('floww:session', { detail: { wallet, health: { ready: false } } })); },
    nav(name) { return nodes.find(node => node.dataset.view === name).trigger('click'); } };
}

function task(id, purpose, payment = 'NOT_STARTED') {
  return { id, revision: 1, purpose, wallet: id === TASK_A ? A : B,
    windowStart: '2026-11-04T00:00:00Z', windowEnd: '2026-11-05T00:00:00Z', createdAt: '2026-11-05T12:00:00Z',
    policy: 'PENDING', payment, delivery: 'NOT_STARTED', events: [], result: null, quote: null, approval: null };
}
function overview() { return { tasks: { active: 0, resultAvailable: 0, recoveryRequired: 0 }, workspace: { memory: 0 },
  budget: { spentAtomic: '0', heldAtomic: '0', activeMandates: 0, dailyLimitAtomic: '1000', reservations: [] }, activity: [] }; }
function conversation(id, owner, withPlan = true) {
  const scope = { purpose: owner === A ? 'A private plan' : 'B private plan', wallet: owner,
    windowStart: '2026-11-04T00:00:00.000Z', windowEnd: '2026-11-05T00:00:00.000Z', resourceId: 'wallet-transfers', missingFields: [] };
  return { id, revision: 1, intentRevision: 1, title: scope.purpose, status: 'APPROVAL_REQUIRED', intent: scope,
    messages: [{ id: id + '-message', role: 'user', text: scope.purpose, at: '2026-11-05T12:00:00Z' }],
    plan: withPlan ? { hash: (owner === A ? 'a' : 'b').repeat(64), scope, summary: scope.purpose, intentRevision: 1,
      steps: [{ role: 'planner', capability: 'wallet-transfers', resourceId: 'wallet-transfers', reason: 'Scripted browser fixture' }],
      limitations: ['Scripted local behavior only'], modelVersion: 'scripted-test' } : null };
}

for (const oldStatus of [200, 401]) test(`delayed owner-A task poll (${oldStatus}) neither leaks into nor logs out owner B`, async () => {
  const old = deferred(); let owner = A, aReads = 0;
  const a = task(TASK_A, 'OWNER_A_PRIVATE_PURPOSE', 'UNKNOWN'), b = task(TASK_B, 'OWNER_B_CURRENT_PURPOSE');
  const h = harness(taskClient, call => {
    if (call.url === '/api/health') return response({ ready: false, network: 'devnet' });
    if (call.url === '/api/session') return response({ wallet: owner });
    if (call.url.startsWith('/api/tasks?')) return response({ tasks: [owner === A ? a : b], nextCursor: null });
    if (call.url === '/api/tasks/' + TASK_A) return ++aReads === 1 ? response(a) : old.promise;
    if (call.url === '/api/tasks/' + TASK_B) return response(b);
    if (call.url === '/api/auth/logout') { owner = null; return response(null, 204); }
    if (call.url === '/api/auth/challenge') return response({ challengeId: 'scripted-auth', message: 'Scripted local authentication fixture' });
    if (call.url === '/api/auth/verify') { owner = B; return response({ wallet: B }); }
    throw new Error('Unexpected request: ' + call.url);
  });
  await until(() => h.get('connect-wallet').title === A && h.get('logout').disabled === false);
  await settle();
  const polling = [...h.intervals.values()][0](); await until(() => aReads === 2);
  await h.get('logout').trigger('click');
  h.window.phantom = { solana: { isPhantom: true, connect: async () => ({ publicKey: { toString: () => B } }),
    signMessage: async () => ({ signature: new Uint8Array(64) }), on() {} } };
  await h.get('connect-wallet').trigger('click'); await settle();
  assert.equal(h.get('connect-wallet').title, B);
  old.resolve(oldStatus === 200 ? response(a) : response({ error: { code: 'AUTHENTICATION_REQUIRED' } }, 401));
  await polling; await settle();
  assert.equal(h.get('connect-wallet').title, B);
  assert.match(h.get('task-list').textContent, /OWNER_B_CURRENT_PURPOSE/);
  assert.doesNotMatch(h.get('task-list').textContent, /OWNER_A_PRIVATE_PURPOSE/);
  assert.ok(h.calls.every(call => call.credentials === 'same-origin' && call.redirect === 'error'));
  assert.ok(h.calls.every(call => !/\/execute$|\/approve$/.test(call.url)));
});

test('logout removes private task draft, approval and rendered report contents before another login', async () => {
  const a = task(TASK_A, 'OWNER_A_PRIVATE_PURPOSE');
  a.result = { answer: { answer_text: 'OWNER_A_PRIVATE_REPORT', limitations: [] }, markdown: 'OWNER_A_PRIVATE_DOWNLOAD' };
  const h = harness(taskClient, call => {
    if (call.url === '/api/health') return response({ ready: false });
    if (call.url === '/api/session') return response({ wallet: A });
    if (call.url.startsWith('/api/tasks?')) return response({ tasks: [a], nextCursor: null });
    if (call.url === '/api/tasks/' + TASK_A) return response(a);
    if (call.url === '/api/auth/logout') return response(null, 204);
    throw new Error('Unexpected request: ' + call.url);
  });
  await until(() => h.get('logout').disabled === false);
  assert.match(h.get('result-content').textContent, /OWNER_A_PRIVATE_REPORT/);
  h.get('purpose').value = 'OWNER_A_PRIVATE_DRAFT'; h.get('report-wallet').value = A;
  h.get('budget').value = '789012'; h.get('approval-ack').checked = true;
  await h.get('logout').trigger('click');
  assert.equal(h.get('purpose').value, ''); assert.equal(h.get('report-wallet').value, '');
  assert.equal(h.get('budget').value, ''); assert.equal(h.get('approval-ack').checked, false);
  assert.doesNotMatch(h.get('result-content').textContent, /OWNER_A_PRIVATE_REPORT/);
  assert.doesNotMatch(h.get('task-list').textContent, /OWNER_A_PRIVATE_PURPOSE/);
  assert.equal(h.get('transaction-link').textContent, '');
});

for (const stale of [false, true]) test(`${stale ? 'old-owner' : 'current-owner'} shell 401 ${stale ? 'preserves B session' : 'invalidates core session and private memory view'}`, async () => {
  const late = deferred(); let owner = A, wait = false, started = false;
  const h = harness(taskClient + '\n' + client, call => {
    if (call.url === '/api/health') return response({ ready: false });
    if (call.url === '/api/session') return response({ wallet: owner });
    if (call.url === '/api/dashboard') return response(overview());
    if (call.url.startsWith('/api/tasks?')) return response({ tasks: [], nextCursor: null });
    if (call.url === '/api/catalog') return response({ resources: [] });
    if (call.url.startsWith('/api/memories?')) {
      if (wait) { started = true; return late.promise; }
      return response({ items: [{ id: 'memory-' + owner, revision: 1,
        data: { key: 'report preference', value: owner === A ? 'OWNER_A_PRIVATE_MEMORY' : 'OWNER_B_CURRENT_MEMORY', expiresAt: '2026-12-01T00:00:00Z' } }], nextCursor: null });
    }
    if (call.url === '/api/auth/logout') { owner = null; return response(null, 204); }
    if (call.url === '/api/auth/challenge') return response({ challengeId: 'scripted', message: 'Local scripted authentication' });
    if (call.url === '/api/auth/verify') { owner = B; return response({ wallet: B }); }
    throw new Error('Unexpected request: ' + call.url);
  });
  await until(() => h.get('logout').disabled === false);
  await h.nav('memory'); await settle();
  assert.match(h.get('memory-list').textContent, /OWNER_A_PRIVATE_MEMORY/);
  wait = true;
  const refreshing = h.get('refresh-memory').trigger('click'); await until(() => started);
  if (stale) {
    await h.get('logout').trigger('click'); wait = false;
    h.window.phantom = { solana: { isPhantom: true, connect: async () => ({ publicKey: { toString: () => B } }),
      signMessage: async () => ({ signature: new Uint8Array(64) }), on() {} } };
    await h.get('connect-wallet').trigger('click'); await settle();
    assert.equal(h.get('connect-wallet').title, B);
    assert.match(h.get('memory-list').textContent, /OWNER_B_CURRENT_MEMORY/);
  }
  late.resolve(response({ error: { code: 'AUTHENTICATION_REQUIRED' } }, 401)); await refreshing; await settle();
  assert.doesNotMatch(h.get('memory-list').textContent, /OWNER_A_PRIVATE_MEMORY/);
  if (stale) {
    assert.equal(h.get('connect-wallet').title, B); assert.match(h.get('memory-list').textContent, /OWNER_B_CURRENT_MEMORY/);
  } else {
    assert.equal(h.get('logout').hidden, true); assert.equal(h.get('connect-wallet').disabled, false);
    assert.equal(h.get('refresh-memory').disabled, true);
  }
});

test('changing wallet clears private mandate drafts, memory contents and consent controls', async () => {
  const h = harness(client, call => {
    if (call.url === '/api/dashboard') return response(overview());
    if (call.url.startsWith('/api/tasks?')) return response({ tasks: [], nextCursor: null });
    if (call.url === '/api/catalog') return response({ resources: [] });
    throw new Error('Unexpected request: ' + call.url);
  });
  h.session(A); await settle();
  h.get('mandate-purpose').value = 'OWNER_A_PRIVATE_MANDATE'; h.get('mandate-wallet').value = A;
  h.get('mandate-total').value = '934567'; h.get('mandate-per').value = '123456'; h.get('mandate-count').value = '89';
  h.get('memory-key').value = 'OWNER_A_PRIVATE_KEY_LABEL'; h.get('memory-value').value = 'OWNER_A_PRIVATE_PREFERENCE';
  h.get('conversation-memory').checked = true; h.get('memory-ack').checked = true; h.get('mandate-ack').checked = true;
  h.session(B); await settle();
  for (const id of ['mandate-purpose', 'mandate-wallet', 'mandate-total', 'mandate-per', 'memory-key', 'memory-value']) assert.equal(h.get(id).value, '', id);
  assert.equal(h.get('mandate-count').value, '5');
  for (const id of ['conversation-memory', 'memory-ack', 'mandate-ack', 'plan-ack']) assert.equal(h.get(id).checked, false, id);
});

test('delayed conversation from the previous wallet cannot restore its dialogue after owner switch', async () => {
  const old = deferred(); let owner = A, waiting = false;
  const a = conversation(CONVERSATION_A, A), b = conversation(CONVERSATION_B, B);
  const h = harness(client, call => {
    if (call.url === '/api/dashboard') return response(overview());
    if (call.url.startsWith('/api/tasks?')) return response({ tasks: [], nextCursor: null });
    if (call.url === '/api/catalog') return response({ resources: [] });
    if (call.url === '/api/mandates') return response({ mandates: [] });
    if (call.url.startsWith('/api/conversations?')) { const c = owner === A ? a : b; return response({ items: [{ id: c.id, data: { title: c.title, status: c.status }, updatedAt: '2026-11-05T12:00:00Z' }], nextCursor: null }); }
    if (call.url === '/api/conversations/' + CONVERSATION_A) { waiting = true; return old.promise; }
    throw new Error('Unexpected request: ' + call.url);
  });
  h.session(A); await settle(); await h.nav('assistant'); await settle();
  const opening = h.get('conversation-list').children[0].trigger('click'); await until(() => waiting);
  owner = B; h.session(B); await settle(); old.resolve(response(a)); await opening; await settle();
  assert.doesNotMatch(h.get('dialogue-messages').textContent, /A private plan/);
  assert.match(h.get('conversation-list').textContent, /B private plan/);
  assert.equal(h.get('send-message').disabled, false);
});

test('first-message automatic conversation creation preserves the user-entered exact scope', async () => {
  let posted; const empty = conversation(CONVERSATION_A, A, false); empty.intent = { purpose: null, wallet: null,
    windowStart: null, windowEnd: null, resourceId: 'wallet-transfers', missingFields: ['purpose', 'wallet', 'windowStart', 'windowEnd'] };
  const h = harness(client, call => {
    if (call.url === '/api/dashboard') return response(overview());
    if (call.url.startsWith('/api/tasks?')) return response({ tasks: [], nextCursor: null });
    if (call.url === '/api/catalog') return response({ resources: [] });
    if (call.url.startsWith('/api/conversations?')) return response({ items: [], nextCursor: null });
    if (call.url === '/api/conversations' && call.method === 'POST') return response(empty, 201);
    if (call.url === '/api/conversations/' + CONVERSATION_A + '/messages') { posted = call.body; return response({ ...empty, revision: 2 }); }
    throw new Error('Unexpected request: ' + call.url);
  });
  h.session(A); await settle();
  h.get('message-text').value = 'Inspect my exact selected scope'; h.get('intent-wallet').value = A;
  h.get('intent-start').value = '2026-11-04T09:00:00'; h.get('intent-end').value = '2026-11-05T09:00:00';
  const expected = { wallet: A, windowStart: new Date(h.get('intent-start').value).toISOString(), windowEnd: new Date(h.get('intent-end').value).toISOString() };
  await h.get('message-form').trigger('submit'); await until(() => posted);
  assert.deepEqual(JSON.parse(JSON.stringify(posted.scope)), expected);
  assert.equal(posted.text, 'Inspect my exact selected scope');
});

test('plan acknowledgement is reset when opening a different conversation and exact plan', async () => {
  const a = conversation(CONVERSATION_A, A), b = conversation(CONVERSATION_B, B);
  const h = harness(client, call => {
    if (call.url === '/api/dashboard') return response(overview());
    if (call.url.startsWith('/api/tasks?')) return response({ tasks: [], nextCursor: null });
    if (call.url === '/api/catalog') return response({ resources: [] });
    if (call.url === '/api/mandates') return response({ mandates: [] });
    if (call.url.startsWith('/api/conversations?')) return response({ items: [a, b].map(c => ({ id: c.id,
      data: { title: c.title, status: c.status }, updatedAt: '2026-11-05T12:00:00Z' })), nextCursor: null });
    if (call.url === '/api/conversations/' + CONVERSATION_A) return response(a);
    if (call.url === '/api/conversations/' + CONVERSATION_B) return response(b);
    throw new Error('Unexpected request: ' + call.url);
  });
  h.session(A); await settle(); await h.nav('assistant'); await settle();
  await h.get('conversation-list').children[0].trigger('click'); await settle();
  h.get('plan-ack').checked = true; await h.get('plan-ack').trigger('change');
  assert.equal(h.get('confirm-plan').disabled, false);
  await h.get('conversation-list').children[1].trigger('click'); await settle();
  assert.equal(h.get('plan-ack').checked, false);
  assert.equal(h.get('confirm-plan').disabled, true);
});

test('task history fetches full results only for the selected summary', async () => {
  const first = task(TASK_A, 'First report'), second = task(TASK_B, 'Second report');
  const full = value => ({ ...value, result: { answer: { answer_text: value.id === TASK_A ? 'FIRST_LAZY_REPORT' : 'SECOND_LAZY_REPORT' }, markdown: 'scripted report' } });
  const h = harness(taskClient, call => {
    if (call.url === '/api/health') return response({ ready: false });
    if (call.url === '/api/session') return response({ wallet: A });
    if (call.url.startsWith('/api/tasks?')) return response({ tasks: [first, second].map(value => ({ ...value, resultAvailable: true, result: undefined })), nextCursor: null });
    if (call.url === '/api/tasks/' + TASK_A) return response(full(first));
    if (call.url === '/api/tasks/' + TASK_B) return response(full(second));
    throw new Error('Unexpected request: ' + call.url);
  });
  await until(() => h.get('logout').disabled === false);
  assert.match(h.get('result-content').textContent, /FIRST_LAZY_REPORT/);
  assert.equal(h.calls.filter(call => call.url === '/api/tasks/' + TASK_A).length, 1);
  assert.equal(h.calls.filter(call => call.url === '/api/tasks/' + TASK_B).length, 0);
  await h.get('task-list').children[1].trigger('click');
  assert.match(h.get('result-content').textContent, /SECOND_LAZY_REPORT/);
  assert.doesNotMatch(h.get('result-content').textContent, /FIRST_LAZY_REPORT/);
  assert.equal(h.calls.filter(call => call.url === '/api/tasks/' + TASK_B).length, 1);
});

test('retrying an unchanged task after an uncertain HTTP result reuses the same idempotency key', async () => {
  let created = 0;
  const h = harness(taskClient, call => {
    if (call.url === '/api/health') return response({ ready: false });
    if (call.url === '/api/session') return response({ wallet: A });
    if (call.url.startsWith('/api/tasks?')) return response({ tasks: [], nextCursor: null });
    if (call.url === '/api/tasks' && call.method === 'POST') {
      if (++created === 1) throw new TypeError('scripted transport interruption');
      return response(task(TASK_A, call.body.purpose), 201);
    }
    throw new Error('Unexpected request: ' + call.url);
  });
  await until(() => h.get('logout').disabled === false);
  const localDate = value => { const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 19); };
  h.get('purpose').value = 'One exact request'; h.get('report-wallet').value = A;
  h.get('window-start').value = localDate(Date.now() - 7200_000); h.get('window-end').value = localDate(Date.now() - 3600_000);
  await h.get('request-form').trigger('submit'); await until(() => created === 1 && h.get('create-task').disabled === false);
  await h.get('request-form').trigger('submit'); await until(() => created === 2 && h.get('create-task').disabled === false);
  const requests = h.calls.filter(call => call.url === '/api/tasks' && call.method === 'POST');
  assert.match(requests[0].headers['Idempotency-Key'], /^[a-f0-9-]{36}$/);
  assert.equal(requests[0].headers['Idempotency-Key'], requests[1].headers['Idempotency-Key']);
  assert.deepEqual(JSON.parse(JSON.stringify(requests[0].body)), JSON.parse(JSON.stringify(requests[1].body)));
  assert.equal(h.get('task-list').children.length, 1);
});

test('budget cards render actual remainingExecutions and retain older holds in the ledger history', async () => {
  const dashboard = overview(); dashboard.budget.reservations = [{ id: 'reservation', taskId: TASK_A, amountAtomic: '1000', state: 'HELD', day: '2026-11-04' }];
  const mandate = { id: 'mandate', purpose: 'Bounded transfers', wallet: A, status: 'ACTIVE',
    windowStart: '2026-11-04T00:00:00Z', windowEnd: '2026-11-05T00:00:00Z', expiresAt: '2026-12-01T00:00:00Z',
    version: 1, remainingAtomic: '5000', spentAtomic: '1000', remainingExecutions: 3 };
  const h = harness(client, call => {
    if (call.url === '/api/dashboard') return response(dashboard);
    if (call.url.startsWith('/api/tasks?')) return response({ tasks: [], nextCursor: null });
    if (call.url === '/api/catalog') return response({ resources: [] });
    if (call.url === '/api/mandates') return response({ mandates: [mandate] });
    throw new Error('Unexpected request: ' + call.url);
  });
  h.session(A); await settle(); await h.nav('budgets'); await settle();
  assert.match(h.get('mandate-list').textContent, /남은 실행3/);
  assert.doesNotMatch(h.get('mandate-list').textContent, /undefined|NaN/);
  assert.match(h.get('budget-metrics').textContent, /오늘.*예약/);
  assert.match(h.get('reservation-list').textContent, /예약 유지/);
  assert.match(h.get('reservation-list').textContent, /2026-11-04/);
});
