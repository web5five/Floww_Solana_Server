import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../service/store.mjs';

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
