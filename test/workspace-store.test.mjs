import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Store } from '../service/store.mjs';
import { WorkspaceStore } from '../service/workspace-store.mjs';
import { ServiceError } from '../service/config.mjs';

const conversation = (title = 'Private purpose') => ({ title, status: 'CLARIFICATION_REQUIRED',
  intent: null, messages: [], operation: null, linkedTaskId: null });
const preference = (now, change = {}) => ({ kind: 'PREFERENCE', key: 'language', value: 'Korean',
  acknowledge: true, expiresAt: new Date(now + 60_000).toISOString(), ...change });
async function setup(file = ':memory:') {
  let now = Date.UTC(2026, 10, 6, 12);
  const store = new Store(file, { clock: () => now });
  return { store, repo: await WorkspaceStore.open(store), now: () => now,
    advance(ms) { now += ms; }, close() { store.close(); } };
}

test('workspace SQLite records isolate owners and kinds with revision-based updates', async () => {
  const f = await setup();
  try {
    const original = conversation(), record = await f.repo.create('owner-a', 'conversation', original);
    original.title = 'mutated caller copy';
    assert.equal((await f.repo.get('owner-a', 'conversation', record.id)).data.title, 'Private purpose');
    await assert.rejects(f.repo.get('owner-b', 'conversation', record.id), { code: 'WORKSPACE_NOT_FOUND' });
    await assert.rejects(f.repo.get('owner-a', 'memory', record.id), { code: 'WORKSPACE_NOT_FOUND' });
    await assert.rejects(f.repo.update('owner-b', 'conversation', record.id, 1, data => { data.title = 'stolen'; }), { code: 'WORKSPACE_NOT_FOUND' });
    const updated = await f.repo.update('owner-a', 'conversation', record.id, 1, data => { data.title = 'Accepted update'; });
    assert.equal(updated.revision, 2);
    await assert.rejects(f.repo.update('owner-a', 'conversation', record.id, 1, () => {}), { code: 'WORKSPACE_CHANGED' });
    assert.equal((await f.repo.get('owner-a', 'conversation', record.id)).data.title, 'Accepted update');
    assert.equal((await f.repo.activity('owner-b')).length, 0);
  } finally { f.close(); }
});

test('independent SQLite connections keep CAS atomic and persist workspace across reopen', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'floww-workspace-store-'));
  let first, second, third;
  try {
    const file = path.join(directory, 'state.sqlite'); first = await setup(file); second = await setup(file);
    const record = await first.repo.create('owner-a', 'conversation', conversation());
    const results = await Promise.allSettled([first, second].map(f => f.repo.update('owner-a', 'conversation', record.id, 1,
      data => { data.title = 'Concurrent winner'; })));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.find(result => result.status === 'rejected').reason.code, 'WORKSPACE_CHANGED');
    first.close(); first = null; second.close(); second = null;
    third = await setup(file);
    assert.equal((await third.repo.get('owner-a', 'conversation', record.id)).revision, 2);
    assert.equal((await third.repo.activity('owner-a')).length, 2);
  } finally { first?.close(); second?.close(); third?.close(); await rm(directory, { recursive: true, force: true }); }
});

test('failed and async workspace mutations roll back data and audit together', async () => {
  const f = await setup();
  try {
    const record = await f.repo.create('owner-a', 'conversation', conversation());
    await assert.rejects(f.repo.update('owner-a', 'conversation', record.id, 1, data => {
      data.title = 'must roll back'; throw new ServiceError('TEST_DENIED', 403);
    }), { code: 'TEST_DENIED' });
    await assert.rejects(f.repo.update('owner-a', 'conversation', record.id, 1, async data => { data.title = 'must roll back'; }),
      { code: 'ASYNC_MUTATION_NOT_ALLOWED' });
    assert.equal((await f.repo.get('owner-a', 'conversation', record.id)).data.title, 'Private purpose');
    assert.equal((await f.repo.activity('owner-a')).length, 1);
    const events = JSON.stringify(await f.repo.activity('owner-a'));
    assert.ok(!events.includes('Private purpose')); assert.ok(!events.includes('must roll back'));
  } finally { f.close(); }
});

test('bounded summary pages remain stable on timestamp ties and never return full conversations', async () => {
  const f = await setup();
  try {
    const ids = [];
    for (let i = 0; i < 7; i++) {
      ids.push((await f.repo.create('owner-a', 'conversation', { ...conversation('record-' + i),
        messages: [{ id: 'large-private-message', text: 'x'.repeat(40_000) }], plan: { private: 'private-plan' } })).id);
    }
    await f.repo.create('owner-b', 'conversation', conversation('other-owner-private'));
    const seen = []; let cursor;
    do {
      const page = await f.repo.page('owner-a', 'conversation', { limit: 2, cursor });
      assert.ok(page.items.length <= 2); seen.push(...page.items.map(item => item.id));
      assert.ok(!JSON.stringify(page).includes('large-private-message'));
      assert.ok(!JSON.stringify(page).includes('private-plan'));
      assert.ok(!JSON.stringify(page).includes('other-owner-private'));
      cursor = page.nextCursor;
    } while (cursor);
    assert.deepEqual(seen, [...ids].sort().reverse()); assert.equal(new Set(seen).size, 7);
    assert.deepEqual(await f.repo.counts('owner-a'), { conversation: 7, memory: 0 });
    for (const options of [{ limit: 0 }, { limit: 51 }, { cursor: 'not a cursor' }, { cursor: 'x'.repeat(301) }]) {
      await assert.rejects(f.repo.page('owner-a', 'conversation', options));
    }
  } finally { f.close(); }
});

test('expired and deleted memories disappear from access, pages and counts without changing expiry', async () => {
  const f = await setup();
  try {
    const expired = await f.repo.create('owner-a', 'memory', preference(f.now(), { expiresAt: new Date(f.now() + 1_000).toISOString() }));
    const deleted = await f.repo.create('owner-a', 'memory', preference(f.now(), { value: 'private preference' }));
    await assert.rejects(f.repo.remove('owner-b', 'memory', deleted.id, 1), { code: 'WORKSPACE_NOT_FOUND' });
    await assert.rejects(f.repo.remove('owner-a', 'memory', deleted.id, 2), { code: 'WORKSPACE_CHANGED' });
    await assert.rejects(f.repo.update('owner-a', 'memory', deleted.id, 1, data => {
      data.expiresAt = new Date(f.now() + 120_000).toISOString();
    }), { code: 'MEMORY_EXPIRY_IMMUTABLE' });
    await f.repo.remove('owner-a', 'memory', deleted.id, 1); f.advance(1_001);
    for (const id of [expired.id, deleted.id]) await assert.rejects(f.repo.get('owner-a', 'memory', id), { code: 'WORKSPACE_NOT_FOUND' });
    assert.equal((await f.repo.page('owner-a', 'memory')).items.length, 0);
    assert.equal((await f.repo.counts('owner-a')).memory, 0);
    assert.ok(!JSON.stringify(await f.repo.activity('owner-a')).includes('private preference'));
  } finally { f.close(); }
});

test('daily model quota reserves atomically and rolls back global count when owner limit fails', async () => {
  const f = await setup();
  try {
    const limits = { globalLimit: 3, ownerLimit: 2 };
    await f.repo.reserveModel('owner-a', 2, limits);
    await assert.rejects(f.repo.reserveModel('owner-a', 1, limits), { code: 'MODEL_DAILY_LIMIT' });
    await f.repo.reserveModel('owner-b', 1, limits);
    await assert.rejects(f.repo.reserveModel('owner-b', 1, limits), { code: 'MODEL_DAILY_LIMIT' });
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => f.repo.reserveModel('owner-c', 1, limits)));
    assert.ok(results.every(result => result.status === 'rejected' && result.reason.code === 'MODEL_DAILY_LIMIT'));
    f.advance(86_400_000); await f.repo.reserveModel('owner-a', 2, limits);
    await f.repo.reserveModel('owner-b', 1, limits);
  } finally { f.close(); }
});

test('record size and active preference capacity are bounded before writes', async () => {
  const f = await setup();
  try {
    await assert.rejects(f.repo.create('owner-a', 'conversation', { text: 'x'.repeat(256_001) }), { code: 'WORKSPACE_RECORD_TOO_LARGE' });
    await assert.rejects(f.repo.create('owner-a', 'memory', preference(f.now(), { value: 'x'.repeat(8_001) })), { code: 'WORKSPACE_RECORD_TOO_LARGE' });
    for (let i = 0; i < 200; i++) await f.repo.create('owner-a', 'memory', preference(f.now()));
    await assert.rejects(f.repo.create('owner-a', 'memory', preference(f.now())), { code: 'WORKSPACE_LIMIT_REACHED' });
    assert.equal((await f.repo.page('owner-a', 'memory', { limit: 50 })).items.length, 50);
    f.advance(60_001); await f.repo.create('owner-a', 'memory', preference(f.now()));
    assert.equal((await f.repo.counts('owner-a')).memory, 1);
  } finally { f.close(); }
});

test('workspace storage errors expose fixed codes without database diagnostics', async () => {
  const f = await setup(); f.close();
  await assert.rejects(f.repo.get('owner-a', 'conversation', 'unavailable'),
    error => error.code === 'WORKSPACE_UNAVAILABLE' && error.message === 'WORKSPACE_UNAVAILABLE');
});
