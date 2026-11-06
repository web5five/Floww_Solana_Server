import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../service/store.mjs';
import { DatabaseSync } from 'node:sqlite';

test('challenge consumption, expiry and session revocation persist', () => {
  let now = 100_000; const store = new Store(':memory:', { clock: () => now });
  try {
    const c = store.challenge('owner', 'http://localhost:4318');
    assert.match(c.message, /http:\/\/localhost:4318/);
    const s = store.authenticate(c.challengeId, 'owner', () => true, 1000);
    assert.equal(store.session(s.token).wallet, 'owner');
    assert.throws(() => store.authenticate(c.challengeId, 'owner', () => true, 1000), /INVALID_CHALLENGE/);
    now += 1000; assert.equal(store.session(s.token), null);
    const c2 = store.challenge('owner', 'http://localhost:4318'); now += 300_000;
    assert.throws(() => store.authenticate(c2.challengeId, 'owner', () => true, 1000), /INVALID_CHALLENGE/);
  } finally { store.close(); }
});
test('restart preserves uncertain claim/proof and clears only in-flight operation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'floww-store-test-')), path = join(dir, 'state.sqlite'); let s;
  try {
    s = new Store(path); s.add({ id: 'task-1', owner: 'owner', payment: 'SIGNING', operation: { id: 'op-1', kind: 'execute' }, attemptRef: 'claim-1', signedData: { paymentHeader: 'test-only-proof' }, events: [] });
    s.close(); s = new Store(path);
    const t = s.get('task-1', 'owner'); assert.equal(t.payment, 'UNKNOWN'); assert.equal(t.operation, null);
    assert.equal(t.attemptRef, 'claim-1'); assert.equal(t.signedData.paymentHeader, 'test-only-proof');
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.throws(() => s.get('task-1', 'other'), /TASK_NOT_FOUND/);
    assert.throws(() => s.mutate('task-1', 'owner', task => { task.payment = 'FAILED'; throw new Error('rollback'); }), /rollback/);
    assert.equal(s.get('task-1', 'owner').payment, 'UNKNOWN');
    assert.equal(s.receipts.claim('proof-1'), true); assert.equal(s.receipts.claim('proof-1'), false);
    s.receipts.put('proof-1', { status: 'SETTLED' }); assert.equal(s.receipts.get('proof-1').status, 'SETTLED');
  } finally { s?.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('state path symlinks are rejected without touching their target', () => {
  const dir = mkdtempSync(join(tmpdir(), 'floww-store-test-'));
  try { writeFileSync(join(dir, 'target'), 'original'); symlinkSync(join(dir, 'target'), join(dir, 'link'));
    assert.throws(() => new Store(join(dir, 'link')), /UNSAFE_STATE_FILE/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('idempotent creation persists replay identity and rejects changed intent across restarts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'floww-idempotency-')), file = join(dir, 'state.sqlite'); let store;
  const options = { idempotencyKey: 'client-key-1', bodyHash: 'a'.repeat(64) };
  try {
    store = new Store(file);
    const original = store.add({ id: 'original', owner: 'owner', events: [], payment: 'NOT_STARTED' }, options);
    const replay = store.add({ id: 'discarded', owner: 'owner', events: [], payment: 'NOT_STARTED' }, options);
    assert.equal(replay.id, original.id); assert.equal(store.list('owner').length, 1);
    assert.throws(() => store.add({ id: 'changed', owner: 'owner' }, { ...options, bodyHash: 'b'.repeat(64) }), /IDEMPOTENCY_CONFLICT/);
    store.close(); store = new Store(file);
    assert.equal(store.add({ id: 'after-restart', owner: 'owner' }, options).id, original.id);
    assert.equal(store.add({ id: 'other-owner', owner: 'other', events: [] }, options).id, 'other-owner');
    assert.throws(() => store.add({ id: 'bad', owner: 'owner' }, { idempotencyKey: 'bad key', bodyHash: options.bodyHash }), /INVALID_IDEMPOTENCY_KEY/);
  } finally { store?.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('stable owner-bound pages exclude private payloads and dashboard includes all pages', () => {
  const store = new Store(':memory:', { clock: () => 100000 });
  try {
    for (let i = 0; i < 45; i++) store.add({ id: String(i).padStart(3, '0'), owner: 'owner', events: [],
      purpose: 'item', payment: i === 0 ? 'UNKNOWN' : 'CONFIRMED', delivery: 'COMPLETED',
      result: { answer: { summary: 'owned' }, html: 'private-large-result' }, signedData: { paymentHeader: 'private-proof' } });
    store.add({ id: 'foreign', owner: 'other', events: [] });
    const first = store.page('owner'), second = store.page('owner', { cursor: first.nextCursor }),
      third = store.page('owner', { cursor: second.nextCursor });
    assert.deepEqual([first.tasks.length, second.tasks.length, third.tasks.length], [20, 20, 5]);
    assert.equal(third.nextCursor, null);
    assert.equal(new Set([...first.tasks, ...second.tasks, ...third.tasks].map(task => task.id)).size, 45);
    assert.equal(first.tasks[0].id, '044'); assert.equal(first.tasks[0].resultAvailable, true);
    assert.doesNotMatch(JSON.stringify(first), /private-large-result|private-proof|paymentHeader|"result"|"html"/);
    assert.throws(() => store.page('other', { cursor: first.nextCursor }), /INVALID_CURSOR/);
    assert.throws(() => store.page('owner', { cursor: first.nextCursor, includeArchived: true }), /INVALID_CURSOR/);
    assert.throws(() => store.page('owner', { cursor: 'not-a-cursor' }), /INVALID_CURSOR/);
    assert.throws(() => store.page('owner', { limit: 51 }), /INVALID_PAGE/);
    store.archive('044', 'owner');
    const stats = store.dashboard('owner');
    assert.equal(stats.total, 45); assert.equal(stats.active, 44); assert.equal(stats.archived, 1);
    assert.equal(stats.payment.UNKNOWN, 1); assert.equal(stats.payment.CONFIRMED, 44); assert.equal(stats.recoveryRequired, 1);
    assert.equal(store.page('owner').tasks.some(task => task.id === '044'), false);
    assert.equal(store.page('owner', { includeArchived: true }).tasks[0].id, '044');
    assert.equal(store.get('044', 'owner').signedData.paymentHeader, 'private-proof');
  } finally { store.close(); }
});
test('active capacity, archival uncertainty and restoration are atomic and retain purchase evidence', () => {
  const store = new Store(':memory:');
  try {
    for (let i = 0; i < 100; i++) store.add({ id: 'task-' + i, owner: 'owner', events: [], payment: 'NOT_STARTED' });
    assert.throws(() => store.add({ id: 'overflow', owner: 'owner' }), /TASK_LIMIT_REACHED/);
    store.archive('task-0', 'owner'); store.add({ id: 'new-active', owner: 'owner', events: [], payment: 'NOT_STARTED' });
    assert.throws(() => store.restore('task-0', 'owner'), /TASK_LIMIT_REACHED/);
    assert.ok(store.get('task-0', 'owner').archivedAt);
    store.archive('task-1', 'owner'); assert.equal(store.restore('task-0', 'owner').archivedAt, null);
    assert.equal(store.dashboard('owner').total, 101); assert.equal(store.dashboard('owner').active, 100);
    assert.throws(() => store.archive('task-2', 'other'), /TASK_NOT_FOUND/);
    for (const payment of ['SIGNING', 'PENDING', 'UNKNOWN']) {
      store.mutate('task-2', 'owner', task => { task.payment = payment; });
      assert.throws(() => store.archive('task-2', 'owner'), /TASK_UNRESOLVED/);
    }
    store.mutate('task-2', 'owner', task => { task.payment = 'CONFIRMED'; task.delivery = 'FAILED'; task.signedData = { paymentHeader: 'original' }; });
    assert.throws(() => store.archive('task-2', 'owner'), /TASK_UNRESOLVED/);
    store.mutate('task-2', 'owner', task => { task.delivery = 'COMPLETED'; task.result = { answer: {} }; });
    store.archive('task-2', 'owner'); assert.equal(store.get('task-2', 'owner').signedData.paymentHeader, 'original');
  } finally { store.close(); }
});
test('immutable task identity and workspace authority survive rejected mutations', () => {
  const store = new Store(':memory:');
  try {
    store.add({ id: 'linked', owner: 'owner', events: [], workspaceContext: { planHash: 'original' } });
    for (const mutate of [task => { task.owner = 'other'; }, task => { task.id = 'other'; },
      task => { task.workspaceContext.planHash = 'changed'; }, async task => { task.revision = 100; }]) {
      assert.throws(() => store.mutate('linked', 'owner', mutate), /TASK_IDENTITY_CHANGED|ASYNC_MUTATION_NOT_ALLOWED/);
    }
    assert.equal(store.get('linked', 'owner').workspaceContext.planHash, 'original');
    assert.equal(store.get('linked', 'owner').revision, 1);
  } finally { store.close(); }
});

test('existing SQLite task schema upgrades without losing an uncertain original proof', () => {
  const dir = mkdtempSync(join(tmpdir(), 'floww-upgrade-')), file = join(dir, 'state.sqlite'); let store;
  try {
    const legacy = new DatabaseSync(file);
    legacy.exec('CREATE TABLE tasks(id TEXT PRIMARY KEY,owner TEXT NOT NULL,revision INTEGER NOT NULL,data TEXT NOT NULL)');
    const data = { id: 'legacy', owner: 'owner', revision: 1, events: [], payment: 'PENDING',
      createdAt: '2026-11-01T00:00:00.000Z', operation: { id: 'old-operation' },
      attemptRef: 'original-attempt', signedData: { paymentHeader: 'original-proof' } };
    legacy.prepare('INSERT INTO tasks(id,owner,revision,data) VALUES(?,?,?,?)').run(data.id, data.owner, 1, JSON.stringify(data));
    legacy.close(); store = new Store(file);
    assert.equal(store.get('legacy', 'owner').payment, 'UNKNOWN');
    assert.equal(store.get('legacy', 'owner').signedData.paymentHeader, 'original-proof');
    assert.equal(store.page('owner').tasks[0].id, 'legacy');
    assert.equal(store.dashboard('owner').recoveryRequired, 1);
    assert.throws(() => store.archive('legacy', 'owner'), /TASK_UNRESOLVED/);
  } finally { store?.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('a saved creation response remains replayable when active capacity is full', () => {
  const store = new Store(':memory:'), options = { idempotencyKey: 'first-request', bodyHash: 'a'.repeat(64) };
  try {
    store.add({ id: 'saved', owner: 'owner', events: [] }, options);
    for (let i = 1; i < 100; i++) store.add({ id: 'task-' + i, owner: 'owner', events: [] });
    assert.equal(store.add({ id: 'discarded', owner: 'owner' }, options).id, 'saved');
    assert.throws(() => store.add({ id: 'new', owner: 'owner' }), /TASK_LIMIT_REACHED/);
  } finally { store.close(); }
});
