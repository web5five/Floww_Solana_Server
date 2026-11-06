import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { createRequestTelemetry } from '../service/observability.mjs';
import { harness, client, taskClient, adminClient, A, B, TASK_A, CONVERSATION_A, response, deferred, settle, until, task, conversation, overview } from './ui-harness.mjs';

const original = JSON.parse(await readFile(new URL('./fixtures/admin-read-v1.json', import.meta.url), 'utf8'));
const source = client + '\n' + adminClient;
const access = () => ({ role: 'ADMIN_READ', expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
const clone = value => structuredClone(value);
const adminCalls = h => h.calls.filter(c => c.url.startsWith('/api/admin/'));
const writes = h => h.calls.filter(c => c.method && c.method !== 'GET');
function boot({ hash = '#/admin', owner = A, locale = 'en', transport, mutate, full = false } = {}) {
  const fixture = clone(original); fixture.access = access(); mutate?.(fixture);
  const control = { owner, fixture, transport, roleStatus: 200, ca: conversation(CONVERSATION_A, A), ta: task(TASK_A, 'ORIGINAL_PRIVATE_TASK') };
  const h = harness((full ? taskClient + '\n' : '') + source, call => {
    const custom = control.transport?.(call, control); if (custom !== undefined) return custom;
    if (call.url === '/api/admin/access') return response(control.roleStatus === 200 ? fixture.access : { error: { code: 'ADMIN_ACCESS_DENIED' } }, control.roleStatus);
    if (call.url === '/api/admin/overview') return response(fixture.overview);
    if (call.url.startsWith('/api/admin/requests?')) return response(fixture.requests);
    if (call.url.startsWith('/api/admin/events?')) return response(fixture.events);
    if (call.url === '/api/health') return response({ workspaceAdapterReady: true, reportAdapterReady: true, modelConfigured: true, ready: false });
    if (call.url === '/api/session') return control.owner ? response({ wallet: control.owner }) : response({ error: { code: 'AUTHENTICATION_REQUIRED' } }, 401);
    if (call.url.startsWith('/api/tasks?')) return response({ tasks: [control.ta], nextCursor: null });
    if (call.url === '/api/tasks/' + TASK_A) return response(control.ta);
    if (call.url === '/api/conversations/' + CONVERSATION_A) return response(control.ca);
    if (call.url.startsWith('/api/conversations?')) return response({ items: [], nextCursor: null });
    if (call.url === '/api/mandates') return response({ mandates: [] });
    if (call.url === '/api/dashboard') return response(overview());
    if (call.url === '/api/catalog') return response({ resources: [] });
    if (call.url.startsWith('/api/activity?')) return response({ events: [] });
    if (call.url.startsWith('/api/memories?')) return response({ items: [], nextCursor: null });
    if (call.url === '/api/auth/logout') { control.owner = null; return response(null, 204); }
    assert.fail('No unscripted work is allowed: ' + call.method + ' ' + call.url);
  }, { hash, savedLocale: locale });
  if (!full) h.emit('floww:session', { wallet: owner, generation: 1, initializing: false });
  return { h, control, fixture };
}
async function ready(options) { const result = boot(options); await until(() => !result.h.get('admin-data').hidden); await settle(); assert.deepEqual(result.h.backgroundErrors, []); return result; }
const subnav = (h, name) => h.document.querySelector('[data-admin-route=' + name + ']').trigger('click');
const visible = node => { for (let n = node; n; n = n.parentNode) if (n.hidden) return false; return true; };

for (const locale of ['ko', 'en']) test(locale + ' authenticated admin renders actual partitions, intersections, process coverage and bounded HTTP records', async () => {
  const { h, fixture } = await ready({ locale });
  assert.equal(h.get('admin-open').hidden, false);
  assert.deepEqual(h.get('admin-metrics').children.map(n => n.querySelector('strong').textContent), ['7', '3', '1', '1']);
  assert.equal(h.get('admin-payment-chart').querySelectorAll('[data-count]').reduce((n, c) => n + Number(c.getAttribute('data-count')), 0), fixture.overview.sources.tasks.data.total);
  const minutes = h.get('admin-traffic').querySelectorAll('[data-minute]'); assert.equal(minutes.length, 1);
  assert.equal(minutes[0].getAttribute('data-minute'), '2026-11-07T03:02:00.000Z');
  assert.match(h.get('admin-traffic-coverage').textContent, /2026/);
  assert.match(h.get('admin-traffic-coverage').textContent, locale === 'en' ? /not observed/ : /관측하지 않았/);
  assert.equal(h.get('admin-request-rows').children.length, 3);
  const t = h.get('admin-request-rows').querySelector('time'); assert.equal(t.getAttribute('datetime'), fixture.requests.data.requests[0].at); assert.match(t.textContent, /2026/);
  assert.equal(writes(h).length, 0); assert.ok(adminCalls(h).every(c => c.credentials === 'same-origin' && c.redirect === 'error'));
});

test('guest direct admin route never requests private data, keeps editable draft and shared explicit login', async () => {
  const { h } = boot({ owner: null }); await settle();
  assert.equal(h.get('admin-access').hidden, false); assert.equal(h.get('admin-data').hidden, true); assert.equal(h.get('admin-open').hidden, true);
  assert.match(h.get('admin-access-title').textContent, /administrator/i); assert.equal(adminCalls(h).length, 0);
  await h.document.querySelector('.admin-return').trigger('click'); await settle();
  assert.equal(h.window.location.hash, '#/assistant'); h.get('message-text').value = 'EXACT_UNSENT_GUEST_DRAFT'; assert.equal(h.get('message-text').disabled, false);
  assert.equal(writes(h).length, 0);
});

for (const code of [403, 503]) test('current access ' + code + ' hides every data source and exposes a truthful gate without expiring normal login', async () => {
  const { h, control } = await ready(); control.roleStatus = code;
  await h.get('admin-refresh').trigger('click'); await settle();
  assert.equal(h.get('admin-open').hidden, true); assert.equal(h.get('admin-data').hidden, true);
  assert.equal(h.get('admin-request-rows').children.length, 0); assert.equal(h.get('admin-metrics').children.length, 0);
  assert.equal(h.events.filter(e => e.type === 'floww:session-expired').length, 0);
  assert.equal(h.get('admin-retry-access').hidden, code === 403);
  assert.equal(writes(h).length, 0);
});

test('current 401 is handled only after its owner/session lease is checked', async () => {
  const { h, control } = await ready(); control.roleStatus = 401;
  await h.get('admin-refresh').trigger('click'); await settle();
  assert.equal(h.get('admin-data').hidden, true); assert.equal(h.events.filter(e => e.type === 'floww:session-expired').length, 1);
});

test('ready-zero task and traffic counts are visibly distinct from an unavailable database source', async () => {
  const { h, control } = await ready({ mutate(f) {
    const d = f.overview.sources.tasks.data;
    for (const k of ['total', 'active', 'archived', 'reportAvailable', 'recoveryRequired']) d[k] = 0;
    for (const group of ['attention', 'policy', 'payment', 'delivery']) for (const k of Object.keys(d[group])) d[group][k] = 0;
    const r = f.overview.sources.runtime.data; r.completed = 0; r.counts = []; r.minuteBuckets[0].completed = 0; r.latencyBuckets[0].count = 0;
  } });
  assert.equal(h.get('admin-metrics').querySelector('strong').textContent, '0'); assert.match(h.get('admin-payment-chart').textContent, /no persisted/i); assert.match(h.get('admin-traffic').textContent, /No HTTP/i);
  control.fixture.overview.sources.tasks = { status: 'unavailable', capturedAt: null, scope: 'current-persisted-task-states', code: 'ADMIN_SOURCE_TIMEOUT' };
  await h.get('admin-refresh').trigger('click');
  assert.equal(h.get('admin-metrics').querySelector('strong').textContent, '—'); assert.match(h.get('admin-tasks-source').textContent, /timed out/i);
  assert.equal(h.get('admin-payment-chart').querySelectorAll('circle').length, 0); assert.ok(h.get('admin-traffic').querySelector('svg'));
});

for (const mutate of [
  f => { f.overview.sources.tasks.data.payment.CONFIRMED++; },
  f => { f.overview.sources.tasks.data.attention.deliveredWithoutReport++; },
  f => { f.overview.sources.tasks.data.coverage.archivedIncluded = false; },
]) test('malformed task math or scope is unavailable rather than displayed as a valid chart', async () => {
  const { h } = await ready({ mutate });
  assert.equal(h.get('admin-metrics').querySelector('strong').textContent, '—'); assert.equal(h.get('admin-payment-chart').querySelectorAll('circle').length, 0);
  assert.match(h.get('admin-tasks-source').textContent, /shape|verified/i); assert.equal(h.get('admin-request-rows').children.length, 3);
});

test('data-quality OTHER/report notes remain explicit and never fabricate successful records', async () => {
  const { h } = await ready({ mutate(f) { f.overview.sources.tasks.data.coverage.invalidReportShapes = 1; } });
  assert.match(h.get('admin-other-states').textContent, /format review.*reports 1/i);
});

test('15/60 minute filter uses only observed rows and is a local-only interaction', async () => {
  const { h } = await ready({ mutate(f) {
    const s = f.overview.sources.runtime, r = s.data; r.startedAt = '2026-11-07T02:30:20.000Z'; r.minuteWindowFrom = r.startedAt;
    r.minuteBuckets = Array.from({ length: 33 }, (_, i) => ({ minute: new Date(Date.parse('2026-11-07T02:30:00.000Z') + i * 60_000).toISOString(), completed: i === 0 ? 3 : 0, incomplete: 0 }));
  } });
  const calls = h.calls.length; assert.equal(h.get('admin-traffic').querySelectorAll('[data-minute]').length, 15);
  h.get('admin-window').value = '60'; await h.get('admin-window').trigger('change');
  const minutes = h.get('admin-traffic').querySelectorAll('[data-minute]'); assert.equal(minutes.length, 33); assert.equal(minutes[0].getAttribute('data-minute'), '2026-11-07T02:30:00.000Z');
  assert.equal(h.calls.length, calls);
});

test('malformed process window cannot synthesize observed zeros or a ready chart', async () => {
  const { h } = await ready({ mutate(f) { f.overview.sources.runtime.data.minuteBuckets[0].minute = '2026-11-07T02:02:00.000Z'; } });
  assert.equal(h.get('admin-traffic').querySelector('svg'), null); assert.match(h.get('admin-runtime-source').textContent, /shape|verified/i);
});

test('actual voice telemetry remains readable in the operator traffic and request views', async () => {
  const capturedAt = original.overview.sources.runtime.capturedAt;
  const telemetry = createRequestTelemetry({ write: () => true, clock: () => 0, wallClock: () => Date.parse(capturedAt) });
  for (const [method, path] of [['GET', '/api/voice/capabilities'], ['POST', '/api/voice/transcriptions']]) {
    const res = new EventEmitter(); res.statusCode = 401;
    telemetry.observeRequest({ method, route: { path }, url: path + '?private=NEVER_DISPLAY_THIS' }, res);
    res.emit('finish');
  }
  const snapshot = telemetry.operatorSnapshot();
  assert.deepEqual(snapshot.requests.map(r => r.route), ['voice_transcription', 'voice_capabilities']);
  const { h } = await ready({ mutate(f) {
    const runtime = f.overview.sources.runtime;
    runtime.data = { ...runtime.data, ...snapshot };
    f.requests.data = { ...f.requests.data, requests: snapshot.requests, retained: snapshot.requests.length };
  } });
  assert.ok(h.get('admin-traffic').querySelector('svg'));
  assert.equal(h.get('admin-request-rows').children.length, 2);
  assert.match(h.get('admin-request-rows').textContent, /voice_transcription/);
  assert.match(h.get('admin-request-rows').textContent, /voice_capabilities/);
  assert.doesNotMatch(h.get('admin-request-rows').textContent, /NEVER_DISPLAY_THIS/);
  assert.doesNotMatch(h.get('admin-runtime-source').textContent, /shape|verified/i);
  assert.equal(writes(h).length, 0);
});

test('event subroute uses the current task-state marker, no private Task links, and canonical timestamps', async () => {
  const { h, fixture } = await ready({ hash: '#/admin/events' });
  assert.equal(h.get('admin-overview').hidden, true); assert.equal(h.get('admin-events-panel').hidden, false);
  assert.equal(h.get('admin-event-rows').children.length, 1); assert.equal(h.get('admin-event-rows').querySelector('a'), null);
  assert.equal(h.get('admin-event-rows').querySelector('time').getAttribute('datetime'), fixture.events.data.events[0].at);
  assert.match(h.get('admin-events-panel').textContent, /not at the time of the event/i);
  assert.ok(adminCalls(h).every(c => !c.url.includes('/overview') && !c.url.includes('/requests'))); assert.equal(writes(h).length, 0);
});

test('event data with missing historical/current-state provenance is not shown as a valid record', async () => {
  const { h } = await ready({ hash: '#/admin/events', mutate(f) { delete f.events.data.stateScope; } });
  assert.doesNotMatch(h.get('admin-event-rows').textContent, /task_ae1908/); assert.match(h.get('admin-events-source').textContent, /shape|verified/i);
});

test('request null time/duration and ring eviction are distinct from zero or complete-window claims', async () => {
  const { h } = await ready({ hash: '#/admin/requests', mutate(f) {
    Object.assign(f.requests.data.requests[0], { at: null, durationMs: null }); Object.assign(f.requests.data, { truncated: true, dropped: 17, unmeasuredTime: 1 });
  } });
  const first = h.get('admin-request-rows').children[0]; assert.match(first.children[0].textContent, /Unmeasured/); assert.match(first.children[3].textContent, /Unmeasured/); assert.equal(first.querySelector('time'), null);
  assert.match(h.get('admin-requests-note').textContent, /200/); assert.match(h.get('admin-requests-note').textContent, /evicted 17/);
});

test('unknown fixed labels never surface raw private text or injected route fragments', async () => {
  const { h } = await ready({ hash: '#/admin/requests', mutate(f) { f.requests.data.requests[0].route = '/private/WALLET_SECRET?token=SECRET'; } });
  assert.doesNotMatch(h.get('admin-surface').textContent, /WALLET_SECRET|token=SECRET/); assert.match(h.get('admin-requests-source').textContent, /shape|verified/i);
});

test('locale changes preserve chart nodes, table focus/filter and do not fetch any API', async () => {
  const { h } = await ready(); h.get('admin-window').value = '15'; const calls = h.calls.length, chart = h.get('admin-traffic').querySelector('svg'), time = h.get('admin-request-rows').querySelector('time');
  h.get('admin-window').focus(); h.window.FlowwLocale.setLanguage('ko');
  assert.equal(h.calls.length, calls); assert.equal(h.get('admin-traffic').querySelector('svg'), chart); assert.equal(h.get('admin-request-rows').querySelector('time'), time);
  assert.equal(h.document.activeElement, h.get('admin-window')); assert.equal(h.get('admin-window').value, '15'); assert.match(h.get('admin-tasks-source').textContent, /2026/);
});

test('canonical admin subroutes and native Back/Forward reload GET state without writes or private history payloads', async () => {
  const { h } = await ready(); await subnav(h, 'events'); await settle(); assert.equal(h.window.location.hash, '#/admin/events');
  await subnav(h, 'requests'); await settle(); assert.equal(h.window.location.hash, '#/admin/requests');
  h.window.history.back(); await settle(); assert.equal(h.get('admin-events-panel').hidden, false);
  h.window.history.forward(); await settle(); assert.equal(h.get('admin-requests-panel').hidden, false);
  assert.ok(h.historyEntries.every(e => e.state === null)); assert.equal(writes(h).length, 0);
});

test('leaving admin erases even hidden private source DOM and locale cannot revive it', async () => {
  const { h } = await ready({ hash: '#/admin/events' }); assert.match(h.get('admin-event-rows').textContent, /task_ae1908/);
  await h.document.querySelector('.admin-return').trigger('click'); await settle(); h.window.FlowwLocale.setLanguage('ko');
  assert.equal(h.get('admin-data').hidden, true); assert.equal(h.get('admin-event-rows').textContent, ''); assert.equal(h.get('admin-metrics').textContent, '');
  assert.equal(h.get('admin-open').hidden, false); assert.equal(writes(h).length, 0);
});

for (const lateStatus of [200, 401, 403]) test('old-owner access ' + lateStatus + ' cannot replace a new owner role or expire its session', async () => {
  const old = deferred(); let first = true;
  const { h } = boot({ transport(call) { if (call.url === '/api/admin/access' && first) { first = false; return old.promise; } } });
  await until(() => adminCalls(h).length === 1); h.emit('floww:session', { wallet: B, generation: 2, initializing: false });
  await until(() => !h.get('admin-data').hidden); const text = h.get('admin-request-rows').textContent;
  old.resolve(response(lateStatus === 200 ? access() : { error: { code: 'ADMIN_ACCESS_DENIED' } }, lateStatus)); await settle();
  assert.equal(h.get('admin-open').hidden, false); assert.equal(h.get('admin-request-rows').textContent, text); assert.equal(h.events.filter(e => e.type === 'floww:session-expired').length, 0);
});

for (const lateStatus of [200, 401, 403]) test('same-wallet session renewal fences old source ' + lateStatus + ' and keeps new data', async () => {
  const old = deferred(); let first = true;
  const { h } = boot({ hash: '#/admin/requests', transport(call) { if (call.url.startsWith('/api/admin/requests?') && first) { first = false; return old.promise; } } });
  await until(() => adminCalls(h).some(c => c.url.startsWith('/api/admin/requests?')));
  h.emit('floww:session', { wallet: A, generation: 2, initializing: false }); await until(() => !h.get('admin-data').hidden);
  old.resolve(response(lateStatus === 200 ? original.requests : { error: { code: 'AUTHENTICATION_REQUIRED' } }, lateStatus)); await settle();
  assert.equal(h.get('admin-open').hidden, false); assert.equal(h.get('admin-request-rows').children.length, 3); assert.equal(h.events.filter(e => e.type === 'floww:session-expired').length, 0);
});

test('logout while source GET is pending clears role and private data before late completion', async () => {
  const old = deferred();
  const { h } = boot({ hash: '#/admin/events', transport(call) { if (call.url.startsWith('/api/admin/events?')) return old.promise; } });
  await until(() => adminCalls(h).some(c => c.url.includes('/events?'))); h.emit('floww:session', { wallet: null, generation: 2, initializing: false });
  old.resolve(response(original.events)); await settle(); h.window.FlowwLocale.setLanguage('ko');
  assert.equal(h.get('admin-data').hidden, true); assert.equal(h.get('admin-event-rows').textContent, ''); assert.equal(h.get('admin-open').hidden, true);
});

test('a slow source after admin exit cannot restore data or hijack focus in the ordinary workspace', async () => {
  const old = deferred();
  const { h } = boot({ transport(call) { if (call.url === '/api/admin/overview') return old.promise; } });
  await until(() => adminCalls(h).some(c => c.url === '/api/admin/overview')); await h.document.querySelector('.admin-return').trigger('click'); await settle();
  h.get('message-text').value = 'UNSENT_DRAFT'; h.get('message-text').focus(); old.resolve(response(original.overview)); await settle();
  assert.equal(h.get('admin-data').hidden, true); assert.equal(h.get('message-text').value, 'UNSENT_DRAFT'); assert.equal(h.document.activeElement, h.get('message-text')); assert.equal(writes(h).length, 0);
});

test('admin navigation retains the ordinary assistant unsent draft and exact financial consent fields', async () => {
  const { h } = boot({ hash: '#/assistant' }); await settle();
  const values = { 'message-text': 'UNSENT_PRODUCT_PURPOSE', 'intent-wallet': B, 'intent-start': '2026-11-04T10:20:30', 'budget': '9.876543219' };
  for (const [id, value] of Object.entries(values)) h.get(id).value = value; h.get('approval-ack').checked = true;
  await h.nav('admin'); await until(() => !h.get('admin-data').hidden); await h.document.querySelector('.admin-return').trigger('click'); await settle();
  for (const [id, value] of Object.entries(values)) assert.equal(h.get(id).value, value); assert.equal(h.get('approval-ack').checked, true);
  assert.equal(writes(h).length, 0);
});

for (const hash of ['#/admin/approve', '#/admin/__proto__', '#/admin/%65vents', '#/admin/events?wallet=SECRET']) test('malformed admin route ' + hash + ' cannot request an arbitrary endpoint', async () => {
  const { h } = boot({ hash, owner: null }); await settle(); assert.equal(h.window.location.hash, '#/assistant'); assert.equal(adminCalls(h).length, 0); assert.equal(writes(h).length, 0);
});

test('guest wallet error from the actual shared sign-in handler is visible on the admin gate', async () => {
  const { h } = boot({ full: true, owner: null }); await until(() => h.get('connect-wallet').disabled === false); await settle();
  await h.get('connect-wallet').trigger('click'); await settle();
  assert.equal(h.get('notice').hidden, false); assert.equal(visible(h.get('notice')), true); assert.match(h.get('notice-text').textContent, /Phantom/);
  assert.equal(h.get('admin-data').hidden, true); assert.equal(adminCalls(h).length, 0); assert.equal(writes(h).length, 0);
});

for (const failing of ['requests', 'overview']) test(failing + ' endpoint failure preserves independent healthy data and the verified admin role', async () => {
  const { h } = await ready({ transport(call) {
    if (call.url === '/api/admin/' + failing || call.url.startsWith('/api/admin/' + failing + '?')) return response({ error: { code: 'SERVICE_DRAINING' } }, 503);
  } });
  assert.equal(h.get('admin-open').hidden, false); assert.equal(h.get('admin-data').hidden, false); assert.equal(h.get('admin-access').hidden, true);
  assert.match(h.get('admin-status').textContent, /Some sources/);
  if (failing === 'requests') { assert.equal(h.get('admin-metrics').querySelector('strong').textContent, '7'); assert.ok(h.get('admin-traffic').querySelector('svg')); assert.match(h.get('admin-requests-source').textContent, /unavailable/); }
  else { assert.equal(h.get('admin-request-rows').children.length, 3); assert.equal(h.get('admin-metrics').querySelector('strong').textContent, '—'); }
  assert.equal(h.events.filter(e => e.type === 'floww:session-expired').length, 0); assert.equal(writes(h).length, 0);
});

test('minute chart offers the exact displayed count values as a keyboard-readable semantic table', async () => {
  const { h, fixture } = await ready(); const details = h.get('admin-traffic').querySelector('details'), table = details.querySelector('table');
  assert.ok(details.querySelector('summary')); assert.equal(table.querySelectorAll('thead th').length, 3);
  const rows = table.querySelectorAll('tbody tr'); assert.equal(rows.length, fixture.overview.sources.runtime.data.minuteBuckets.length);
  assert.equal(rows[0].children[1].textContent, '3'); assert.equal(rows[0].children[2].textContent, '0');
  assert.equal(rows[0].querySelector('time').getAttribute('datetime'), fixture.overview.sources.runtime.data.minuteBuckets[0].minute);
  const calls = h.calls.length; details.open = true; h.window.FlowwLocale.setLanguage('ko'); assert.equal(details.open, true); assert.equal(h.calls.length, calls);
});

test('capped telemetry qualifies visible runtime totals as lower bounds', async () => {
  const { h } = await ready({ mutate(f) { f.overview.sources.runtime.data.countersCapped = true; } });
  assert.match(h.get('admin-runtime-source').textContent, /lower bounds/); assert.ok(h.get('admin-traffic').querySelector('svg'));
});

test('manual refresh reauthorizes, erases prior records while pending and never executes financial work', async () => {
  const { h, control } = await ready(); const accessPending = deferred();
  control.transport = call => call.url === '/api/admin/access' ? accessPending.promise : undefined;
  const before = adminCalls(h).length, work = h.get('admin-refresh').trigger('click'); await settle();
  assert.equal(adminCalls(h).length, before + 1); assert.equal(h.get('admin-request-rows').textContent, ''); assert.equal(h.get('admin-data').hidden, true);
  accessPending.resolve(response(access())); await work; await settle(); assert.equal(h.get('admin-request-rows').children.length, 3); assert.equal(writes(h).length, 0);
});

test('bounded show-more remains enabled after load and discloses query truncation independently of ring retention', async () => {
  const { h, control } = await ready({ hash: '#/admin/requests', mutate(f) { f.requests.data.hasMore = true; f.requests.data.retained = 101; } });
  assert.equal(h.get('admin-more-requests').hidden, false); assert.equal(h.get('admin-more-requests').disabled, false);
  await h.get('admin-more-requests').trigger('click'); await settle(); assert.ok(adminCalls(h).some(c => c.url === '/api/admin/requests?limit=50'));
  assert.equal(h.get('admin-more-requests').disabled, false); await h.get('admin-more-requests').trigger('click'); await settle();
  assert.ok(adminCalls(h).some(c => c.url === '/api/admin/requests?limit=100')); assert.equal(h.get('admin-more-requests').hidden, true); assert.match(h.get('admin-requests-note').textContent, /query limit/);
  assert.equal(writes(h).length, 0); control.fixture.requests.data.hasMore = false;
});

test('expired access response cannot expose a console or private source GET', async () => {
  const { h } = boot({ mutate(f) { f.access.expiresAt = new Date(Date.now() - 1000).toISOString(); } }); await settle();
  assert.equal(h.get('admin-data').hidden, true); assert.equal(h.get('admin-open').hidden, true); assert.equal(adminCalls(h).length, 1);
  assert.match(h.get('admin-access-title').textContent, /unverified/); assert.equal(h.get('admin-retry-access').hidden, false);
});


test('joint attention counts must agree with the payment partition before they can be shown', async () => {
  const { h } = await ready({ mutate(f) { const d = f.overview.sources.tasks.data; d.attention.unresolvedPayments--; d.attention.confirmedUndelivered++; } });
  assert.equal(h.get('admin-metrics').querySelector('strong').textContent, '—'); assert.match(h.get('admin-tasks-source').textContent, /verified/i);
});

test('actual shared Task component retains its exact nine-decimal quote and consent through admin and Back', async () => {
  const quoted = { ...task(TASK_A, 'EXACT_AUTHORIZED_TASK'), quote: { hash: 'a'.repeat(64), amountAtomic: '1234567891', assetDecimals: 9,
    asset: A, network: 'solana:devnet', recipient: B, payer: A, resourceUrl: 'https://resource.example/transfers', expiresAt: new Date(Date.now() + 1_200_000).toISOString() } };
  const { h } = boot({ full: true, hash: '#/tasks/' + TASK_A, transport(call) {
    if (call.url === '/api/health') return response({ ready: true, merchantConfigured: true, workspaceAdapterReady: true, reportAdapterReady: true, modelConfigured: true });
    if (call.url === '/api/tasks/' + TASK_A) return response(quoted);
  } });
  await until(() => h.get('quote-price').textContent.includes('1.234567891')); await settle();
  const taskNode = h.get('task-execution-column'), quoteText = h.get('quote-details').textContent;
  h.get('budget').value = '9.876543219'; h.get('approval-ack').checked = true;
  await h.nav('admin'); await until(() => !h.get('admin-data').hidden); h.window.history.back(); await settle();
  assert.equal(h.window.location.hash, '#/tasks/' + TASK_A); assert.equal(h.get('task-execution-column'), taskNode);
  assert.equal(h.get('quote-details').textContent, quoteText); assert.match(h.get('quote-price').textContent, /1\.234567891/);
  assert.equal(h.get('budget').value, '9.876543219'); assert.equal(h.get('approval-ack').checked, true); assert.equal(writes(h).length, 0); assert.deepEqual(h.backgroundErrors, []);
});


test('metric cards have their own owner-guarded snapshot provenance and locale-safe cleanup', async () => {
  const { h, fixture } = await ready(); const caption = h.get('admin-metrics-source'), calls = h.calls.length;
  assert.match(caption.textContent, /2026/); assert.match(caption.textContent, /archived included/); assert.equal(caption.getAttribute('title'), fixture.overview.sources.tasks.capturedAt);
  h.window.FlowwLocale.setLanguage('ko'); assert.match(caption.textContent, /보관 포함/); assert.match(caption.textContent, /2026/); assert.equal(h.calls.length, calls);
  await h.document.querySelector('.admin-return').trigger('click'); await settle(); h.window.FlowwLocale.setLanguage('en');
  assert.equal(caption.textContent, ''); assert.equal(caption.getAttribute('title'), null); assert.equal(writes(h).length, 0);
});


const sharedEnglish = {
  admin: ['ADMINISTRATOR · READ ONLY', 'Operations overview', 'Review HTTP observations and persisted task states by source.'],
  overview: ['YOUR WORKSPACE', 'Good decisions start with a clear purpose.', 'Manage purpose, evidence and execution in one workspace.'],
  assistant: ['YOUR INTENT. YOUR TERMS.', 'What would you like\nto get done?', 'Tell us what you need. Review the scope and cost, then follow the evidence to your answer.'],
  tasks: ['EXECUTION & EVIDENCE', 'Clear evidence for every action.', 'Follow approved terms through payment, delivery and analysis.'],
  memory: ['YOUR CONTEXT', 'Context for your next conversation.', 'Manage saved preferences and choose whether to use them in each conversation.'],
  budgets: ['BOUNDED AUTHORITY', 'Set limits and follow spending.', 'Review purpose-specific budget permissions, reservations and spending.'],
  activity: ['WORKSPACE ACTIVITY', 'Your changes at a glance.', 'See when your conversations and memories changed.'],
};
const sharedMetadata = ['view-eyebrow', 'view-title', 'view-description'];
for (const [view, english] of Object.entries(sharedEnglish)) test('full-client bootstrap ' + view + ' keeps all shared metadata live through KO–EN–KO without refetch', async () => {
  const { h } = boot({ full: true, hash: '#/' + view, locale: 'ko' });
  await until(() => !h.get('logout').disabled); if (view === 'admin') await until(() => !h.get('admin-data').hidden); await settle();
  const nodes = sharedMetadata.map(id => h.get(id)), korean = nodes.map(n => n.textContent), calls = h.calls.length;
  h.get('interface-language').value = 'en'; await h.get('interface-language').trigger('change');
  assert.deepEqual(nodes.map(n => n.textContent), english); assert.equal(h.calls.length, calls);
  if (view === 'admin') { assert.match(h.get('admin-metrics-source').textContent, /archived included/); assert.match(h.get('admin-runtime-source').textContent, /Current process/); }
  h.get('interface-language').value = 'ko'; await h.get('interface-language').trigger('change');
  assert.deepEqual(nodes.map(n => n.textContent), korean); assert.ok(nodes.every((n, i) => n === h.get(sharedMetadata[i]))); assert.equal(h.calls.length, calls);
  if (view === 'admin') assert.match(h.get('admin-metrics-source').textContent, /보관 포함/); assert.equal(writes(h).length, 0); assert.deepEqual(h.backgroundErrors, []);
});

test('actual same-wallet renewal preserves public header localization while private source bindings renew', async () => {
  const { h, control } = await ready({ full: true, locale: 'ko' });
  control.transport = call => {
    if (call.url === '/api/auth/challenge') return response({ challengeId: TASK_A, message: 'Scripted local authentication challenge' });
    if (call.url === '/api/auth/verify') return response({ wallet: A });
  };
  h.window.phantom = { solana: { isPhantom: true, connect: async () => ({ publicKey: { toString: () => A } }),
    signMessage: async () => ({ signature: new Uint8Array(64) }) } };
  await h.get('connect-wallet').trigger('click'); await until(() => !h.get('admin-data').hidden && !h.get('logout').disabled); await settle();
  assert.ok(h.events.some(e => e.type === 'floww:session' && e.detail.generation >= 2));
  const calls = h.calls.length; h.get('interface-language').value = 'en'; await h.get('interface-language').trigger('change');
  assert.deepEqual(sharedMetadata.map(id => h.get(id).textContent), sharedEnglish.admin); assert.match(h.get('admin-metrics-source').textContent, /archived included/);
  h.get('interface-language').value = 'ko'; await h.get('interface-language').trigger('change');
  assert.deepEqual(sharedMetadata.map(id => h.get(id).textContent), ['관리자 · 읽기 전용', '운영 현황', 'HTTP 관측과 저장된 작업의 상태를 원본별로 확인합니다.']);
  assert.match(h.get('admin-metrics-source').textContent, /보관 포함/); assert.equal(h.calls.length, calls);
  assert.deepEqual(writes(h).map(c => c.url), ['/api/auth/challenge', '/api/auth/verify']); assert.deepEqual(h.backgroundErrors, []);
});


for (const language of ['ko', 'en']) test(language + ' payment and secondary state legends keep separate exact count rows and miniature decorative swatches', async () => {
  const { h, fixture } = await ready({ locale: language });
  const paymentRows = h.get('admin-payment-legend').children; assert.equal(paymentRows.length, 7);
  assert.deepEqual(paymentRows.map(row => row.querySelector('dd').textContent), Object.values(fixture.overview.sources.tasks.data.payment).map(String));
  const allRows = h.get('admin-surface').querySelectorAll('.admin-state-legend div');
  assert.equal(allRows.length, 16);
  for (const row of allRows) {
    const label = row.querySelector('dt'), swatch = label.querySelector('svg');
    assert.equal(swatch.getAttribute('width'), '9'); assert.equal(swatch.getAttribute('height'), '10'); assert.equal(swatch.getAttribute('viewBox'), '0 0 9 10');
    assert.equal(swatch.classList.contains('admin-swatch'), true); assert.equal(swatch.getAttribute('aria-hidden'), 'true');
    assert.ok(label.querySelector('span').textContent); assert.ok(row.querySelector('dd').textContent); assert.equal(row.children.length, 2);
  }
  assert.equal(h.get('admin-payment-chart').querySelector('svg').getAttribute('viewBox'), '0 0 150 150'); assert.equal(writes(h).length, 0);
});
