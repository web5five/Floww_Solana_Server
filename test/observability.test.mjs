import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { createRequestTelemetry } from '../service/observability.mjs';
import { createApp } from '../service/app.mjs';
import { loadConfig } from '../service/config.mjs';
import { Store } from '../service/store.mjs';

const id = '12345678-1234-1234-1234-123456789abc';
function response(statusCode = 200) {
  const res = new EventEmitter(); res.statusCode = statusCode; res.writableFinished = false;
  return res;
}
test('telemetry records fixed route labels without reading private request fields', () => {
  const lines = []; let at = 10;
  const telemetry = createRequestTelemetry({ write: line => lines.push(line), clock: () => at });
  const req = { method: 'POST', requestId: id, route: { path: '/api/tasks/:id/execute' } };
  for (const key of ['url', 'originalUrl', 'path', 'headers', 'body', 'query', 'params', 'wallet', 'owner']) {
    Object.defineProperty(req, key, { get() { throw new Error('Private request field was read'); } });
  }
  const res = response(503); telemetry.observeRequest(req, res); telemetry.observeRequest(req, res);
  at = 125; res.writableFinished = true; res.emit('finish'); res.emit('close');
  assert.deepEqual(JSON.parse(lines[0]), { event: 'http_request', requestId: id, method: 'POST',
    route: 'task_execute', status: 503, outcome: 'completed', durationMs: 115 });
  assert.equal(lines.length, 1); assert.equal(telemetry.snapshot().completed, 1);
  assert.deepEqual(telemetry.snapshot().counts, { 'POST:task_execute:5xx': 1 });
});
test('a socket closed before response completion never becomes a successful response', () => {
  const lines = [], telemetry = createRequestTelemetry({ write: line => lines.push(line), clock: () => 0 });
  const res = response(); telemetry.observeRequest({ method: 'GET', route: { path: '/api/tasks/:id' } }, res);
  res.emit('close'); res.emit('finish');
  assert.equal(JSON.parse(lines[0]).outcome, 'incomplete'); assert.equal(JSON.parse(lines[0]).status, null);
  assert.equal(telemetry.snapshot().incomplete, 1); assert.equal(telemetry.snapshot().completed, 0);
});
test('finish after socket destruction stays incomplete even when the close event is delayed', () => {
  const lines = [], telemetry = createRequestTelemetry({ write: line => lines.push(line), clock: () => 0 });
  for (const destroyed of ['response', 'socket']) {
    const res = response(); telemetry.observeRequest({ method: 'GET', route: { path: '/api/session' } }, res);
    res.writableFinished = true;
    if (destroyed === 'response') res.destroyed = true; else res.socket = { destroyed: true };
    res.emit('finish'); res.emit('close');
  }
  assert.equal(lines.length, 2);
  assert.ok(lines.every(line => JSON.parse(line).outcome === 'incomplete' && JSON.parse(line).status === null));
  assert.equal(telemetry.snapshot().completed, 0); assert.equal(telemetry.snapshot().incomplete, 2);
});
test('unknown dynamic routes and methods cannot create unbounded labels or retain secrets', () => {
  const lines = [], telemetry = createRequestTelemetry({ write: line => lines.push(line), maxLogsPerMinute: 5, clock: () => 0 });
  for (let i = 0; i < 2000; i++) {
    const res = response(404);
    telemetry.observeRequest({ method: 'PRIVATE-' + i, requestId: 'Bearer-private',
      route: { path: '/api/tasks/private-wallet-' + i + '?secret=private-proof' } }, res); res.emit('finish');
  }
  assert.deepEqual(telemetry.snapshot().counts, { 'OTHER:unclassified:4xx': 2000 });
  assert.equal(lines.length, 5); assert.equal(telemetry.snapshot().suppressed, 1995);
  assert.doesNotMatch(lines.join(''), /Bearer|wallet|secret|proof/);
  assert.equal(JSON.parse(lines[0]).requestId, null);
});
test('log rate bound resets and sink failures/backpressure never change request outcomes', async () => {
  let at = 0, mode = 'false';
  const telemetry = createRequestTelemetry({ clock: () => at, maxLogsPerMinute: 1, write: () => {
    if (mode === 'throw') throw new Error('private sink error');
    if (mode === 'async') return Promise.reject(new Error('private asynchronous sink error'));
    return false;
  } });
  const run = () => { const res = response(200); telemetry.observeRequest({ method: 'GET', requestId: id }, res); res.emit('finish'); };
  run(); run(); at = 60_000; mode = 'throw'; run();
  at = 120_000; mode = 'async'; run(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(telemetry.snapshot().completed, 4); assert.equal(telemetry.snapshot().suppressed, 4);
});
test('snapshots are detached and histogram/cardinality stay bounded', () => {
  let at = 0;
  const telemetry = createRequestTelemetry({ clock: () => at, maxLogsPerMinute: 0 });
  const res = response(429); telemetry.observeRequest({ method: 'POST', route: { path: '/merchant/reports/:resourceId' } }, res);
  at = 300; res.emit('finish');
  const snapshot = telemetry.snapshot(); snapshot.counts.injected = 1; snapshot.latencyBuckets[0].count = 999;
  assert.equal(telemetry.snapshot().counts.injected, undefined);
  assert.equal(telemetry.snapshot().latencyBuckets[0].count, 0);
  assert.equal(telemetry.snapshot().latencyBuckets.find(b => b.upperMs === 500).count, 1);
  assert.throws(() => createRequestTelemetry({ maxLogsPerMinute: 10_001 }), /INVALID_TELEMETRY_CONFIGURATION/);
});
test('a failing clock does not break response completion or invent measured latency', () => {
  const lines = [], telemetry = createRequestTelemetry({ write: line => lines.push(line), clock: () => { throw new Error('clock unavailable'); } });
  const res = response(200); telemetry.observeRequest({ method: 'GET', route: { path: '/readyz' } }, res);
  assert.doesNotThrow(() => res.emit('finish'));
  assert.equal(JSON.parse(lines[0]).durationMs, null);
  assert.equal(telemetry.snapshot().completed, 1); assert.equal(telemetry.snapshot().unmeasuredLatency, 1);
  assert.equal(telemetry.snapshot().latencyBuckets.reduce((sum, bucket) => sum + bucket.count, 0), 0);
});
test('real HTTP diagnostics correlate request IDs while excluding private URL and cookie data', async () => {
  const server = createServer(), store = new Store(':memory:'), lines = [];
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const config = loadConfig({ FLOWW_PUBLIC_ORIGIN: origin });
  const telemetry = createRequestTelemetry({ write: line => lines.push(line) });
  const app = createApp({ config, store, gateway: { readiness: async () => ({ ready: false }) },
    adapterStatus: { workspaceAdapterReady: true, reportAdapterReady: true },
    observeRequest: telemetry.observeRequest });
  server.on('request', app);
  try {
    const invalidQuery = await fetch(origin + '/api/tasks?secret=private-proof');
    assert.equal(invalidQuery.status, 400); await invalidQuery.text();
    const privateRead = await fetch(origin + '/api/tasks', { headers: { Cookie: 'floww_session=private-session' } });
    assert.equal(privateRead.status, 401); await privateRead.text();
    const ready = await fetch(origin + '/readyz'); assert.equal(ready.status, 200); await ready.text();
    const records = lines.map(line => JSON.parse(line));
    assert.equal(records.find(record => record.route === 'tasks' && record.status === 401).requestId, privateRead.headers.get('x-request-id'));
    assert.equal(records.find(record => record.route === 'readiness').status, 200);
    assert.doesNotMatch(lines.join(''), /private-proof|private-session|secret=|Cookie/);
    assert.equal(telemetry.snapshot().completed, 3);
  } finally {
    server.closeIdleConnections(); await new Promise(resolve => server.close(resolve)); store.close();
  }
});
test('operator minutes cover only process observation and retain at most sixty UTC buckets', () => {
  let epoch = Date.UTC(2026, 10, 7, 3, 1, 20);
  const telemetry = createRequestTelemetry({ write: () => {}, clock: () => 0, wallClock: () => epoch });
  const finish = () => { const res = response(); telemetry.observeRequest({ method: 'GET', route: { path: '/livez' } }, res); res.emit('finish'); };
  finish();
  let snapshot = telemetry.operatorSnapshot();
  assert.equal(snapshot.startedAt, '2026-11-07T03:01:20.000Z'); assert.equal(snapshot.minuteBuckets.length, 1);
  assert.equal(snapshot.minuteWindowFrom, snapshot.startedAt); assert.equal(snapshot.minuteBuckets[0].completed, 1);
  epoch += 120_000; finish(); snapshot = telemetry.operatorSnapshot();
  assert.deepEqual(snapshot.minuteBuckets.map(row => row.completed), [1, 0, 1]);
  epoch += 61 * 60_000; snapshot = telemetry.operatorSnapshot();
  assert.equal(snapshot.minuteBuckets.length, 60); assert.equal(snapshot.minuteWindowFrom, '2026-11-07T03:05:00.000Z');
  assert.ok(snapshot.minuteBuckets.every(row => row.completed === 0)); assert.equal(snapshot.completed, 2);
});
test('unmeasured or backwards wall time never fabricates a timestamp or minute history', () => {
  let epoch = Date.UTC(2026, 10, 7, 3, 1, 20);
  const telemetry = createRequestTelemetry({ write: () => {}, clock: () => 0, wallClock: () => epoch });
  const finish = () => { const res = response(); telemetry.observeRequest({ method: 'GET', route: { path: '/api/admin/events' } }, res); res.emit('finish'); };
  epoch -= 1; finish(); assert.throws(() => telemetry.operatorSnapshot(), /ADMIN_CLOCK_UNAVAILABLE/);
  epoch += 2; const snapshot = telemetry.operatorSnapshot();
  assert.equal(snapshot.requests[0].at, null); assert.equal(snapshot.requests[0].route, 'admin_events');
  assert.equal(snapshot.unmeasuredTime, 1); assert.equal(snapshot.clockRegressions, 2);
  assert.equal(snapshot.minuteBuckets[0].completed, 0); assert.equal(snapshot.completed, 1);
});
test('operator request history is detached, fixed-label and bounded even when stdout is suppressed', () => {
  const telemetry = createRequestTelemetry({ maxLogsPerMinute: 0 });
  for (let i = 0; i < 205; i++) { const res = response(); telemetry.observeRequest({ method: 'GET', route: { path: '/private/' + i } }, res); res.emit('finish'); }
  const first = telemetry.operatorSnapshot(); assert.equal(first.requests.length, 200); assert.equal(first.retainedAway, 5);
  assert.equal(first.suppressed, 205); assert.ok(first.requests.every(row => row.route === 'unclassified'));
  first.requests[0].route = 'private'; first.minuteBuckets[0].completed = -1;
  const second = telemetry.operatorSnapshot(); assert.equal(second.requests[0].route, 'unclassified'); assert.equal(second.minuteBuckets[0].completed, 205);
});
