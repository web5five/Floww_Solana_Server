import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { Store } from '../service/store.mjs';
import { WorkspaceStore } from '../service/workspace-store.mjs';

test('actual file SQLite voice admissions persist independently from model role buckets across reopen', async () => {
  const directory = await mkdtemp('/tmp/floww-voice-quota-'), filename = path.join(directory, 'owned.sqlite');
  let store = new Store(filename), repo = await WorkspaceStore.open(store);
  try {
    await repo.reserveModel('scripted-owner', 1);
    await repo.reserveVoice('scripted-owner', 2, { globalCalls: 2, ownerCalls: 1, globalSeconds: 3, ownerSeconds: 2 });
    const before = store.db.prepare('SELECT bucket,used FROM workspace_model_usage ORDER BY bucket').all();
    assert.equal(before.length, 6); assert.equal(before.filter(row => row.bucket.startsWith('voice:v1:')).length, 4);
    store.close(); store = new Store(filename); repo = await WorkspaceStore.open(store);
    assert.deepEqual(store.db.prepare('SELECT bucket,used FROM workspace_model_usage ORDER BY bucket').all(), before);
    await assert.rejects(repo.reserveVoice('scripted-owner', 1, { globalCalls: 2, ownerCalls: 1, globalSeconds: 3, ownerSeconds: 2 }), { code: 'VOICE_DAILY_LIMIT' });
    assert.deepEqual(store.db.prepare('SELECT bucket,used FROM workspace_model_usage ORDER BY bucket').all(), before);
    await repo.reserveVoice('other-scripted-owner', 1, { globalCalls: 2, ownerCalls: 1, globalSeconds: 3, ownerSeconds: 2 });
    await assert.rejects(repo.reserveVoice('third-owner', 1, { globalCalls: 2, ownerCalls: 1, globalSeconds: 3, ownerSeconds: 2 }), { code: 'VOICE_DAILY_LIMIT' });
  } finally { store.close(); await rm(directory, { recursive: true, force: true }); }
});
test('corrupted SQLite quota rows reject before any partial increment', async () => {
  const store = new Store(':memory:'), repo = await WorkspaceStore.open(store);
  try {
    await repo.reserveVoice('scripted-owner', 1);
    const bucket = store.db.prepare("SELECT bucket FROM workspace_model_usage WHERE bucket LIKE 'voice:v1:%:global:seconds'").get().bucket;
    for (const value of [-1, 0.5, 'not-a-number', '9007199254740992']) {
      store.db.prepare('UPDATE workspace_model_usage SET used=? WHERE bucket=?').run(value, bucket);
      const before = store.db.prepare('SELECT bucket,CAST(used AS TEXT) AS used FROM workspace_model_usage ORDER BY bucket').all();
      await assert.rejects(repo.reserveVoice('scripted-owner', 1), { code: 'VOICE_QUOTA_UNAVAILABLE' });
      assert.deepEqual(store.db.prepare('SELECT bucket,CAST(used AS TEXT) AS used FROM workspace_model_usage ORDER BY bucket').all(), before);
    }
  } finally { store.close(); }
});
