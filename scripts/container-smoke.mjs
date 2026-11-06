import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { start } from '../service/main.mjs';
import { loadConfig } from '../service/config.mjs';
import { Store } from '../service/store.mjs';

// CI image acceptance. No external network, database, secrets or funded payer.
assert.notEqual(process.getuid(), 0, 'The deployed image must run without root');
const imported = spawnSync('python3', ['-c', 'import ai_baseline.workspace_cli, ai_baseline.integration_cli'], {
  env: { PATH: process.env.PATH, PYTHONPATH: 'reference', PYTHONDONTWRITEBYTECODE: '1' }, encoding: 'utf8',
});
assert.equal(imported.status, 0, 'Image must include the actual Python role/report adapters');
const runtime = await start({ config: loadConfig({}), store: new Store(':memory:') });
try {
  const origin = runtime.config.origin;
  const page = await fetch(origin + '/');
  assert.equal(page.status, 200); assert.match(await page.text(), /workspace-client\.js/);
  for (const path of ['/api/tasks', '/api/conversations', '/api/memories', '/api/mandates', '/api/dashboard']) {
    assert.equal((await fetch(origin + path)).status, 401);
  }
  const health = await (await fetch(origin + '/api/health')).json();
  assert.equal(health.databaseReady, true); assert.equal(health.ready, false);
  assert.equal(health.paymentEnabled, false); assert.equal(health.modelConfigured, false);
  assert.equal((await runtime.planner.plan({})).code, 'MODEL_NOT_CONFIGURED');
  process.stdout.write('Non-root image: Node/Python imports, workspace, private routes and disabled payment guards verified.\n');
} finally { await runtime.close(); }
