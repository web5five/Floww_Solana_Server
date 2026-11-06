import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, readFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import path from 'node:path';
import { Store } from '../service/store.mjs';
import { PostgresStore } from '../service/postgres-store.mjs';
import { WorkspaceStore } from '../service/workspace-store.mjs';
import { createMandateService } from '../service/mandates.mjs';
import { createAdminReader } from '../service/admin-reader.mjs';
import { createLifecycle } from '../service/lifecycle.mjs';
import { loadConfig } from '../service/config.mjs';

const lifecycle = () => createLifecycle({ probe: async () => ({ databaseReady: true, ledgerReady: true }) });
const hash = value => createHash('sha256').update(value).digest('hex');
async function fixture() {
  const directory = await mkdtemp('/tmp/floww-admin-'), filename = path.join(directory, 'state.sqlite');
  const store = new Store(filename), life = lifecycle();
  await WorkspaceStore.open(store); await createMandateService({ store, config: loadConfig({}) });
  return { store, life, directory, filename, close: async () => { await life.whenIdle(); store.close(); await rm(directory, { recursive: true, force: true }); } };
}
test('real file SQLite projects nonempty states/events read-only and preserves private bytes/revisions', async () => {
  const f = await fixture();
  try {
    const values = [
      { policy: 'PENDING', payment: 'NOT_STARTED', delivery: 'NOT_STARTED' },
      { policy: 'ALLOW', payment: 'UNKNOWN', delivery: 'PENDING' },
      { policy: 'ALLOW', payment: 'CONFIRMED', delivery: 'FAILED', archivedAt: '2026-11-06T00:00:00.000Z' },
      { policy: 'ALLOW', payment: 'CONFIRMED', delivery: 'COMPLETED', result: { answer: 'private invalid primitive' } },
      { policy: 'ALLOW', payment: 'CONFIRMED', delivery: 'COMPLETED', result: { answer: { private: 'actual saved shape' } } },
      { policy: 'PRIVATE_OWNER', payment: 'PRIVATE_PROOF', delivery: 'PRIVATE_URL' },
    ];
    for (const value of values) {
      const task = { id: randomUUID(), owner: 'private-owner', purpose: 'private-purpose', signedData: 'private-proof',
        createdAt: '2026-11-05T00:00:00.000Z', ...value, events: [{ at: '2026-11-06T00:00:00.000Z', type: 'PRIVATE_EVENT', code: 'PRIVATE_CODE' }] };
      f.store.add(task); if (value.archivedAt) f.store.db.prepare('UPDATE tasks SET archived=1 WHERE id=?').run(task.id);
    }
    const day = new Date().toISOString().slice(0, 10);
    f.store.db.prepare('INSERT INTO workspace_model_usage(bucket,used) VALUES(?,?)').run(day + ':global', 4);
    const bucket = JSON.stringify({ heldAtomic: '9999999999999999999', spentAtomic: '2', executionsHeld: 2, executionsSpent: 3 });
    f.store.db.prepare('INSERT INTO workspace_budget_buckets(payer,day,owner,data) VALUES(?,?,?,?)').run('private-payer', day, '*', bucket);
    f.store.db.prepare('INSERT INTO workspace_budget_buckets(payer,day,owner,data) VALUES(?,?,?,?)').run('private-payer', day, 'private-owner', bucket);
    const before = { bytes: hash(await readFile(f.filename)), stat: await stat(f.filename), rows: f.store.db.prepare('SELECT revision,data FROM tasks ORDER BY id').all() };
    let spawned = 0;
    const { Worker } = await import('node:worker_threads');
    const reader = createAdminReader({ store: f.store, lifecycle: f.life, workerFactory: (url, options) => {
      spawned++; assert.deepEqual(options.env, {}); assert.deepEqual(options.execArgv, []); return new Worker(url, options);
    } });
    const [first, second] = await Promise.all([reader.snapshot(), reader.snapshot()]);
    assert.equal(first, second); assert.ok(Object.isFrozen(first.tasks.data)); assert.equal(spawned, 1);
    assert.equal(first.tasks.status, 'ready'); assert.equal(first.tasks.data.total, 6); assert.equal(first.tasks.data.archived, 1);
    assert.deepEqual(first.tasks.data.attention, { unresolvedPayments: 1, confirmedUndelivered: 1, deliveredWithoutReport: 1 });
    assert.deepEqual(first.tasks.data.coverage, { archivedIncluded: true, invalidStateTasks: 1, invalidReportShapes: 1 });
    assert.equal(first.tasks.data.reportAvailable, 1); assert.equal(first.events.status, 'ready');
    assert.ok(first.events.data.every(event => event.event === 'OTHER' && event.reason === 'OTHER'));
    assert.equal(first.usage.data.days.at(-1).admittedRoleCalls, 4);
    assert.deepEqual(first.executions.data.days.at(-1), { day, heldExecutions: 2, observedExecutions: 3 });
    assert.doesNotMatch(JSON.stringify(first), /private-|PRIVATE_|actual saved|Atomic|wallet|payer|purpose|proof/);
    assert.equal(await reader.snapshot(), first); assert.equal(spawned, 1);
    await f.life.whenIdle();
    assert.equal(hash(await readFile(f.filename)), before.bytes);
    assert.deepEqual(f.store.db.prepare('SELECT revision,data FROM tasks ORDER BY id').all(), before.rows);
    assert.equal((await stat(f.filename)).mtimeMs, before.stat.mtimeMs);
  } finally { await f.close(); }
});
test('SQLite unsupported and replaced file identities are explicit unavailable sources', async () => {
  const memory = new Store(':memory:'), life = lifecycle();
  try {
    const source = await createAdminReader({ store: memory, lifecycle: life }).snapshot();
    assert.ok(Object.values(source).every(value => value.code === 'ADMIN_SOURCE_UNSUPPORTED' && !('data' in value)));
  } finally { memory.close(); }
  const f = await fixture();
  try {
    assert.throws(() => { f.store.adminReadSource = { path: 'other.sqlite' }; }, TypeError);
    await rm(f.filename); const replacement = new Store(f.filename); replacement.close();
    const source = await createAdminReader({ store: f.store, lifecycle: f.life }).snapshot();
    assert.ok(Object.values(source).every(value => value.status === 'unavailable' && !('data' in value)));
  } finally { await f.close(); }
});
test('timed-out worker observation retains real flight and lifecycle work through actual exit', async () => {
  const f = await fixture(), children = [];
  try {
    const reader = createAdminReader({ store: f.store, lifecycle: f.life, timeoutMs: 5, workerFactory() {
      const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
      child.kills = 0; child.terminate = () => { child.kills++; return Promise.resolve(); }; children.push(child); return child;
    } });
    const a = await reader.snapshot(); assert.equal(a.tasks.code, 'ADMIN_SOURCE_TIMEOUT'); assert.equal(children.length, 1); assert.equal(children[0].kills, 1);
    assert.equal(f.life.counts().work, 1); assert.equal(await reader.snapshot(), a); assert.equal(children.length, 1);
    children[0].emit('exit', 1); await f.life.whenIdle(); await new Promise(resolve => setImmediate(resolve));
    const next = reader.snapshot(); assert.equal(children.length, 2); children[1].emit('exit', 0); await next;
    assert.equal(f.life.counts().work, 0);
  } finally { for (const child of children) child.emit('exit', 1); await f.close(); }
});
test('actual locked-file SQLite timeout terminates only its owned read worker and drains through exit', async () => {
  const f = await fixture(); let worker, exits = 0;
  try {
    const { Worker } = await import('node:worker_threads');
    f.store.db.exec('BEGIN EXCLUSIVE');
    const reader = createAdminReader({ store: f.store, lifecycle: f.life, timeoutMs: 10,
      workerFactory: (url, options) => { worker = new Worker(url, options); worker.once('exit', () => { exits++; }); return worker; } });
    const observed = await reader.snapshot(); assert.equal(observed.tasks.code, 'ADMIN_SOURCE_TIMEOUT');
    await f.life.whenIdle(); assert.equal(exits, 1); assert.equal(f.life.counts().work, 0);
    f.store.db.exec('ROLLBACK');
    assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM tasks').get().n, 0);
  } finally { try { f.store.db.exec('ROLLBACK'); } catch {} if (!exits) await worker?.terminate(); await f.close(); }
});
test('PostgreSQL source errors roll back to savepoint and release the one existing client', async () => {
  const calls = []; let connects = 0, released = 0;
  const client = { async query(text) {
    calls.push(text);
    if (text.includes('count(*) AS n')) throw Object.assign(new Error('private SQL diagnostic'), { code: '57014' });
    return { rows: [] };
  }, release(error) { assert.equal(error, undefined); released++; } };
  const store = new PostgresStore({ connect: async () => { connects++; return client; } }, Date.now), life = lifecycle();
  const reader = createAdminReader({ store, lifecycle: life });
  const [first, second] = await Promise.all([reader.snapshot(), reader.snapshot()]);
  assert.equal(first, second); assert.equal(connects, 1); assert.equal(released, 1);
  assert.equal(first.tasks.code, 'ADMIN_SOURCE_TIMEOUT'); assert.equal(first.usage.status, 'ready'); assert.equal(first.executions.status, 'ready');
  assert.ok(calls.includes('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'));
  assert.ok(calls.includes("SET LOCAL statement_timeout='750ms'")); assert.ok(calls.includes('ROLLBACK TO SAVEPOINT admin_source'));
  assert.equal(calls.at(-1), 'ROLLBACK'); assert.equal(life.counts().work, 0);
  assert.doesNotMatch(JSON.stringify(first), /private SQL/);
});
test('HTTP observation timeout cannot release a queued PostgreSQL acquisition or open another', async () => {
  let connect, connects = 0, rollback, releases = 0;
  const store = new PostgresStore({ connect: () => { connects++; return new Promise(resolve => { connect = resolve; }); } }, Date.now), life = lifecycle();
  const reader = createAdminReader({ store, lifecycle: life, timeoutMs: 5 });
  const observed = await reader.snapshot(); assert.equal(observed.tasks.code, 'ADMIN_SOURCE_TIMEOUT');
  assert.equal(await reader.snapshot(), observed); assert.equal(connects, 1); assert.equal(life.counts().work, 1);
  connect({ query: text => text === 'ROLLBACK' ? new Promise(resolve => { rollback = resolve; }) : Promise.resolve({ rows: [] }), release() { releases++; } });
  for (let i = 0; i < 10 && !rollback; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(releases, 0); assert.equal(life.counts().work, 1); rollback({ rows: [] });
  await life.whenIdle(); assert.equal(releases, 1); assert.equal(connects, 1);
});
test('ambiguous PostgreSQL BEGIN failure discards only the owned client with a fixed diagnostic', async () => {
  const calls = []; let released;
  const store = new PostgresStore({ connect: async () => ({ query: async text => {
    calls.push(text); throw new Error('private connection detail after possible BEGIN admission');
  }, release(error) { released = error; } }) }, Date.now), life = lifecycle();
  const result = await createAdminReader({ store, lifecycle: life }).snapshot();
  assert.deepEqual(calls, ['BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY']);
  assert.equal(released?.message, 'ADMIN_SOURCE_UNAVAILABLE'); assert.equal(life.counts().work, 0);
  assert.ok(Object.values(result).every(source => source.status === 'unavailable' && !('data' in source)));
  assert.doesNotMatch(JSON.stringify(result) + String(released), /private connection|admission/);
});
