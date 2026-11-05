import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import path from 'node:path';
import { PostgresStore } from '../service/postgres-store.mjs';
import { ServiceError } from '../service/config.mjs';

const exec = promisify(execFile);
let cluster, first, second, now = Date.now(), unavailable;
const clock = () => now;
const owner = () => 'test-owner-' + randomUUID();
const task = (wallet = owner()) => ({ id: randomUUID(), owner: wallet, events: [],
  operation: null, payment: 'NOT_STARTED', delivery: 'NOT_STARTED', count: 0 });

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function localCluster() {
  let bin;
  try { bin = execFileSync('pg_config', ['--bindir'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
  if (!['initdb', 'pg_ctl'].every(name => existsSync(path.join(bin, name))) || process.getuid?.() === 0) return null;
  const root = await mkdtemp('/tmp/floww-pg-');
  const data = path.join(root, 'data'), socket = path.join(root, 'socket'), port = await freePort();
  await mkdir(socket, { mode: 0o700 });
  const control = path.join(bin, 'pg_ctl');
  const stop = async () => {
    try { await exec(control, ['-D', data, '-m', 'fast', '-w', 'stop'], { timeout: 20_000 }); } catch {}
    let stopped = false;
    try { await exec(control, ['-D', data, 'status']); }
    catch (error) { stopped = error.code === 3; }
    if (!stopped) throw new Error('LOCAL_POSTGRES_NOT_STOPPED');
    await rm(root, { recursive: true, force: true });
    console.log('Stopped and removed owned PostgreSQL cluster: ' + root);
  };
  try {
    await exec(path.join(bin, 'initdb'), ['-D', data, '--no-locale', '--encoding=UTF8',
      '--auth-local=trust', '--auth-host=trust', '--username=floww_test'], { timeout: 20_000 });
    await exec(control, ['-D', data, '-l', path.join(root, 'server.log'), '-w', '-o',
      `-h 127.0.0.1 -p ${port} -k ${socket} -c shared_buffers=16MB -c max_connections=30`, 'start'], { timeout: 20_000 });
  } catch {
    try { await stop(); } catch {}
    throw new Error('LOCAL_POSTGRES_SETUP_FAILED');
  }
  console.log('Started isolated PostgreSQL test cluster: ' + root);
  return { root, url: `postgresql://floww_test@127.0.0.1:${port}/postgres`, stop };
}

before(async () => {
  cluster = await localCluster();
  if (!cluster) {
    unavailable = 'Existing non-root PostgreSQL binaries are required for real database checks';
    if (process.env.FLOWW_REQUIRE_POSTGRES_TESTS === 'true') throw new Error(unavailable);
    return;
  }
  first = await PostgresStore.open(cluster.url, { clock });
  second = await PostgresStore.open(cluster.url, { clock });
});
beforeEach(() => { now += 61_000; });
after(async () => {
  await Promise.allSettled([first?.close(), second?.close()]);
  if (cluster) await cluster.stop();
});
const real = (name, fn) => test(name, async t => {
  if (unavailable) { t.skip(unavailable); return; }
  await fn(t);
});

real('PostgreSQL challenge consumption is single-use across independent pools', async () => {
  const wallet = owner(), challenge = await first.challenge(wallet, 'http://127.0.0.1:4318');
  const results = await Promise.allSettled(Array.from({ length: 8 }, (_, index) =>
    (index % 2 ? first : second).authenticate(challenge.challengeId, wallet, () => true, 60_000)));
  const successes = results.filter(result => result.status === 'fulfilled');
  assert.equal(successes.length, 1);
  assert.ok(results.filter(result => result.status === 'rejected').every(result => result.reason.code === 'INVALID_CHALLENGE'));
  const session = successes[0].value;
  assert.equal((await second.session(session.token)).wallet, wallet);
  const stored = await first.pool.query('SELECT hash FROM floww_runtime.sessions WHERE wallet=$1', [wallet]);
  assert.equal(stored.rows[0].hash, createHash('sha256').update(session.token).digest('hex'));
  assert.ok(!JSON.stringify(stored.rows).includes(session.token));
  await first.logout(session.token); assert.equal(await second.session(session.token), null);
});
real('PostgreSQL signature failures, async checks and expired challenges cannot authenticate', async () => {
  const wallet = owner(), c = await first.challenge(wallet, 'https://floww.example');
  await assert.rejects(first.authenticate(c.challengeId, wallet, () => false, 60_000), { code: 'INVALID_SIGNATURE' });
  await assert.rejects(second.authenticate(c.challengeId, wallet, async () => true, 60_000), { code: 'INVALID_SIGNATURE' });
  assert.match(c.message, /URI: https:\/\/floww\.example/);
  assert.match(c.message, /does not approve a payment/);
  now += 5 * 60_000;
  await assert.rejects(first.authenticate(c.challengeId, wallet, () => true, 60_000), { code: 'INVALID_CHALLENGE' });
});
real('PostgreSQL wallet challenge limit is atomic under concurrent requests', async () => {
  const wallet = owner();
  const results = await Promise.allSettled(Array.from({ length: 9 }, (_, i) =>
    (i % 2 ? first : second).challenge(wallet, 'https://floww.example')));
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 5);
  assert.ok(results.filter(x => x.status === 'rejected').every(x => x.reason.code === 'RATE_LIMITED'));
});
real('PostgreSQL global challenge limit is atomic across different wallets and pools', async () => {
  const results = await Promise.allSettled(Array.from({ length: 105 }, (_, i) =>
    (i % 2 ? first : second).challenge(owner(), 'https://floww.example')));
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 100);
  assert.ok(results.filter(x => x.status === 'rejected').every(x => x.reason.code === 'RATE_LIMITED'));
});
real('PostgreSQL SELECT FOR UPDATE prevents concurrent task state loss', async () => {
  const value = task(); await first.add(value);
  await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? first : second)
    .mutate(value.id, value.owner, current => { current.count++; })));
  const saved = await second.get(value.id, value.owner);
  assert.equal(saved.count, 20); assert.equal(saved.revision, 21);
});
real('PostgreSQL rejects asynchronous mutation and rolls back partial changes', async () => {
  const value = task(); await first.add(value);
  await assert.rejects(first.mutate(value.id, value.owner, async current => { current.count = 100; }),
    { code: 'ASYNC_MUTATION_NOT_ALLOWED' });
  await assert.rejects(second.mutate(value.id, value.owner, current => {
    current.count = 200; throw new ServiceError('POLICY_TEST_DENIED', 403);
  }), { code: 'POLICY_TEST_DENIED' });
  const saved = await first.get(value.id, value.owner);
  assert.equal(saved.count, 0); assert.equal(saved.revision, 1);
});
real('PostgreSQL failed multi-statement transaction rolls back and redacts raw diagnostics', async () => {
  const value = task(); await first.add(value);
  await assert.rejects(first.transaction(async client => {
    await client.query('UPDATE floww_runtime.tasks SET revision=99 WHERE id=$1', [value.id]);
    throw new Error('SECRET db provider detail');
  }), error => error.code === 'STATE_UNAVAILABLE' && !JSON.stringify(error).includes('SECRET'));
  const stored = await first.pool.query('SELECT revision FROM floww_runtime.tasks WHERE id=$1', [value.id]);
  assert.equal(Number(stored.rows[0].revision), 1);
});
real('PostgreSQL owner isolation and identity constraints survive malicious identifiers', async () => {
  const value = task(); await first.add(value);
  await assert.rejects(first.get(value.id, "x'; DELETE FROM floww_runtime.tasks; --"), { code: 'TASK_NOT_FOUND' });
  await assert.rejects(second.mutate(value.id, owner(), () => {}), { code: 'TASK_NOT_FOUND' });
  await assert.rejects(first.mutate(value.id, value.owner, current => { current.owner = owner(); }), { code: 'TASK_IDENTITY_CHANGED' });
  assert.equal((await second.get(value.id, value.owner)).owner, value.owner);
});
real('PostgreSQL 100-task cap is atomic across connections', async () => {
  const wallet = owner();
  await Promise.all(Array.from({ length: 95 }, () => first.add(task(wallet))));
  const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => (i % 2 ? first : second).add(task(wallet))));
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 5);
  assert.ok(results.filter(x => x.status === 'rejected').every(x => x.reason.code === 'TASK_LIMIT_REACHED'));
  assert.equal((await second.list(wallet)).length, 100);
});
real('PostgreSQL second startup preserves a live operation; expired signing becomes UNKNOWN', async () => {
  const value = task();
  Object.assign(value, { payment: 'SIGNING', attemptRef: 'attempt-kept', signedData: { paymentHeader: 'original-saved-proof' },
    operation: { id: 'operation-kept', kind: 'execute', expiresAt: now + 120_000 } });
  await first.add(value);
  const restarted = await PostgresStore.open(cluster.url, { clock });
  try {
    assert.equal((await restarted.get(value.id, value.owner)).operation.id, 'operation-kept');
    now += 120_001;
    const recovered = await restarted.get(value.id, value.owner);
    assert.equal(recovered.payment, 'UNKNOWN'); assert.equal(recovered.operation, null);
    assert.equal(recovered.nextAction, 'RECONCILE');
    assert.equal(recovered.attemptRef, 'attempt-kept');
    assert.deepEqual(recovered.signedData, { paymentHeader: 'original-saved-proof' });
    assert.equal((await first.get(value.id, value.owner)).payment, 'UNKNOWN');
  } finally { await restarted.close(); }
});
real('PostgreSQL expired quote and recover leases unlock without signing or losing evidence', async () => {
  for (const payment of ['NOT_STARTED', 'CONFIRMED', 'PENDING']) {
    const value = task();
    Object.assign(value, { payment, attemptRef: 'attempt-kept', signedData: { saved: true },
      operation: { id: 'expired', kind: payment === 'NOT_STARTED' ? 'quote' : 'recover', expiresAt: now - 1 } });
    await first.add(value);
    const result = (await second.list(value.owner))[0];
    assert.equal(result.operation, null); assert.deepEqual(result.signedData, { saved: true });
    assert.equal(result.nextAction, payment === 'NOT_STARTED' ? 'QUOTE' : payment === 'CONFIRMED' ? 'RECOVER' : 'RECONCILE');
    assert.equal(result.payment, payment === 'PENDING' ? 'UNKNOWN' : payment);
  }
});
real('PostgreSQL merchant receipt claims have one winner and durable completion', async () => {
  const key = 'receipt-' + randomUUID();
  const results = await Promise.all(Array.from({ length: 10 }, (_, i) => (i % 2 ? first : second).receipts.claim(key)));
  assert.equal(results.filter(Boolean).length, 1); assert.equal(await first.receipts.get(key), null);
  await second.receipts.put(key, { transaction: 'saved-transaction', bodyDigest: 'body-hash' });
  assert.deepEqual(await first.receipts.get(key), { transaction: 'saved-transaction', bodyDigest: 'body-hash' });
  assert.equal(await first.receipts.claim(key), false);
});

function fakePool(query) {
  return { on() {}, ended: false, released: [],
    async connect() { return { query, release: error => this.released.push(error) }; },
    query, async end() { this.ended = true; } };
}
test('PostgreSQL remote TLS cannot be weakened by connection-string sslmode', async () => {
  let captured;
  const pool = fakePool(async () => ({ rows: [] }));
  const store = await PostgresStore.open('postgresql://test-user:dummy-value@db.example.test/new-db?sslmode=require', {
    poolFactory: config => { captured = config; return pool; },
  });
  assert.deepEqual(captured.ssl, { rejectUnauthorized: true });
  assert.equal(captured.connectionString, undefined);
  await store.close(); assert.equal(pool.ended, true);
  await assert.rejects(PostgresStore.open('postgresql://test-user:dummy-value@db.example.test/new-db?sslmode=disable', {
    poolFactory: () => { throw new Error('must not connect'); },
  }), { code: 'DATABASE_TLS_REQUIRED' });
});
test('PostgreSQL initialization and rollback failures release connections without raw secrets', async () => {
  const pool = fakePool(async () => { throw new Error('SECRET provider connection detail'); });
  await assert.rejects(PostgresStore.open('postgresql://test-user@127.0.0.1/new-db', { poolFactory: () => pool }),
    error => error.code === 'STATE_UNAVAILABLE' && !JSON.stringify(error).includes('SECRET'));
  assert.equal(pool.released.length, 1); assert.equal(pool.ended, true);
  const broken = fakePool(async sql => {
    if (sql === 'BEGIN') return { rows: [] };
    throw new Error('SECRET rollback failed');
  });
  const store = new PostgresStore(broken, clock);
  await assert.rejects(store.transaction(() => { throw new Error('SECRET action'); }), { code: 'STATE_UNAVAILABLE' });
  assert.equal(broken.released[0].message, 'STATE_UNAVAILABLE');
});
