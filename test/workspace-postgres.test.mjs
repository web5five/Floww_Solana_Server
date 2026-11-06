import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import path from 'node:path';
import { PostgresStore } from '../service/postgres-store.mjs';
import { WorkspaceStore } from '../service/workspace-store.mjs';
import { ServiceError } from '../service/config.mjs';

const exec = promisify(execFile);
let root, data, control, first, second, repoA, repoB, unavailable;
let now = Date.UTC(2026, 10, 6, 12);
const clock = () => now;
const owner = () => 'workspace-test-' + randomUUID();
const conversation = title => ({ title, status: 'CLARIFICATION_REQUIRED', intent: null, messages: [] });

before(async () => {
  let bin;
  try { bin = execFileSync('pg_config', ['--bindir'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { unavailable = 'Existing PostgreSQL binaries required'; }
  if (process.getuid?.() === 0 || !bin || !['initdb', 'pg_ctl'].every(name => existsSync(path.join(bin, name)))) {
    unavailable ??= 'Existing non-root PostgreSQL binaries required';
    if (process.env.FLOWW_REQUIRE_POSTGRES_TESTS === 'true') throw new Error(unavailable);
    return;
  }
  root = await mkdtemp('/tmp/floww-workspace-pg-'); data = path.join(root, 'data'); control = path.join(bin, 'pg_ctl');
  const socket = path.join(root, 'socket'); await mkdir(socket, { mode: 0o700 });
  const portServer = createServer();
  await new Promise((resolve, reject) => portServer.listen(0, '127.0.0.1', resolve).once('error', reject));
  const port = portServer.address().port; await new Promise(resolve => portServer.close(resolve));
  await exec(path.join(bin, 'initdb'), ['-D', data, '--no-locale', '--encoding=UTF8',
    '--auth-local=trust', '--auth-host=trust', '--username=floww_workspace_test'], { timeout: 20_000 });
  await exec(control, ['-D', data, '-l', path.join(root, 'server.log'), '-w', '-o',
    `-h 127.0.0.1 -p ${port} -k ${socket} -c shared_buffers=16MB -c max_connections=30`, 'start'], { timeout: 20_000 });
  const url = `postgresql://floww_workspace_test@127.0.0.1:${port}/postgres`;
  first = await PostgresStore.open(url, { clock }); second = await PostgresStore.open(url, { clock });
  repoA = await WorkspaceStore.open(first); repoB = await WorkspaceStore.open(second);
  console.log('Started owned workspace PostgreSQL cluster: ' + root);
});
after(async () => {
  await Promise.allSettled([first?.close(), second?.close()]);
  if (!root) return;
  try { await exec(control, ['-D', data, '-m', 'fast', '-w', 'stop'], { timeout: 20_000 }); } catch {}
  let stopped = false;
  try { await exec(control, ['-D', data, 'status']); } catch (error) { stopped = error.code === 3; }
  if (!stopped) throw new Error('OWNED_POSTGRES_NOT_STOPPED');
  await rm(root, { recursive: true, force: true });
  console.log('Stopped and removed owned workspace PostgreSQL cluster: ' + root);
});
const real = (name, fn) => test(name, async t => { if (unavailable) { t.skip(unavailable); return; } await fn(); });

real('workspace PostgreSQL row locks preserve CAS and owner isolation across independent pools', async () => {
  const wallet = owner(), record = await repoA.create(wallet, 'conversation', conversation('private owner goal'));
  const results = await Promise.allSettled(Array.from({ length: 8 }, (_, index) =>
    (index % 2 ? repoA : repoB).update(wallet, 'conversation', record.id, 1, data => { data.title = 'single CAS winner'; })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.ok(results.filter(result => result.status === 'rejected').every(result => result.reason.code === 'WORKSPACE_CHANGED'));
  assert.equal((await repoB.get(wallet, 'conversation', record.id)).revision, 2);
  await assert.rejects(repoB.get(owner(), 'conversation', record.id), { code: 'WORKSPACE_NOT_FOUND' });
  assert.equal((await repoA.activity(wallet)).length, 2);
  assert.ok(!JSON.stringify(await repoA.activity(wallet)).includes('private owner goal'));
  assert.equal((await first.pool.query("SELECT to_regclass('public.workspace_records') AS table_ref")).rows[0].table_ref, null);
});

real('workspace PostgreSQL mutation failures roll back data and audit as one transaction', async () => {
  const wallet = owner(), record = await repoA.create(wallet, 'conversation', conversation('unchanged'));
  await assert.rejects(repoB.update(wallet, 'conversation', record.id, 1, async data => { data.title = 'not saved'; }),
    { code: 'ASYNC_MUTATION_NOT_ALLOWED' });
  await assert.rejects(repoA.update(wallet, 'conversation', record.id, 1, data => {
    data.title = 'not saved'; throw new ServiceError('TEST_DENIED', 403);
  }), { code: 'TEST_DENIED' });
  assert.equal((await repoB.get(wallet, 'conversation', record.id)).data.title, 'unchanged');
  assert.equal((await repoB.activity(wallet)).length, 1);
});

real('workspace PostgreSQL model quota serializes global and per-owner limits without lost counts', async () => {
  const wallets = [owner(), owner(), owner()], limits = { globalLimit: 7, ownerLimit: 3 };
  const results = await Promise.allSettled(Array.from({ length: 27 }, (_, index) =>
    (index % 2 ? repoA : repoB).reserveModel(wallets[index % 3], 1, limits)));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 7);
  assert.ok(results.filter(result => result.status === 'rejected').every(result => result.reason.code === 'MODEL_DAILY_LIMIT'));
  const day = new Date(now).toISOString().slice(0, 10);
  const global = await first.pool.query('SELECT used FROM floww_runtime.workspace_model_usage WHERE bucket=$1', [day + ':global']);
  assert.equal(Number(global.rows[0].used), 7);
  for (const wallet of wallets) {
    const result = await first.pool.query('SELECT used FROM floww_runtime.workspace_model_usage WHERE bucket=$1', [day + ':owner:' + wallet]);
    assert.ok(Number(result.rows[0]?.used ?? 0) <= 3);
  }
  now += 86_400_000; await repoB.reserveModel(wallets[0], 3, limits);
});

real('workspace PostgreSQL page summaries and memory deletion/expiry match SQLite visibility', async () => {
  const wallet = owner(), ids = [];
  for (let i = 0; i < 5; i++) ids.push((await repoA.create(wallet, 'conversation', {
    ...conversation('record-' + i), messages: [{ text: 'private-large-' + 'x'.repeat(20_000) }], plan: { private: true },
  })).id);
  const seen = []; let cursor;
  do {
    const page = await repoB.page(wallet, 'conversation', { limit: 2, cursor });
    seen.push(...page.items.map(item => item.id)); assert.ok(!JSON.stringify(page).includes('private-large-'));
    cursor = page.nextCursor;
  } while (cursor);
  assert.deepEqual(seen, [...ids].sort().reverse());
  const value = { kind: 'PREFERENCE', key: 'language', value: 'Korean', expiresAt: new Date(now + 1_000).toISOString(), acknowledge: true };
  const removed = await repoA.create(wallet, 'memory', value), expired = await repoA.create(wallet, 'memory', value);
  await repoB.remove(wallet, 'memory', removed.id, 1); now += 1_001;
  for (const id of [removed.id, expired.id]) await assert.rejects(repoA.get(wallet, 'memory', id), { code: 'WORKSPACE_NOT_FOUND' });
  assert.equal((await repoB.page(wallet, 'memory')).items.length, 0);
  assert.equal((await repoB.counts(wallet)).memory, 0);
});
