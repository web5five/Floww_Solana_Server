import assert from 'node:assert/strict';
import { start } from '../service/main.mjs';
import { loadConfig } from '../service/config.mjs';
import { Store } from '../service/store.mjs';

// CI image acceptance. No external network, database, secrets or funded payer.
assert.notEqual(process.getuid(), 0, 'The deployed image must run without root');
const runtime = await start({ config: loadConfig({}), store: new Store(':memory:') });
try {
  assert.equal(runtime.adapterStatus.workspaceAdapterReady, true, 'Image must contain the actual workspace adapter');
  assert.equal(runtime.adapterStatus.reportAdapterReady, true, 'Image must contain the actual report adapter');
  assert.equal(Object.isFrozen(runtime.adapterStatus), true);
  const origin = runtime.config.origin;
  const page = await fetch(origin + '/');
  assert.equal(page.status, 200); assert.match(await page.text(), /workspace-client\.js/);
  for (const path of ['/api/tasks', '/api/conversations', '/api/memories', '/api/mandates', '/api/dashboard']) {
    assert.equal((await fetch(origin + path)).status, 401);
  }
  const health = await (await fetch(origin + '/api/health')).json();
  assert.equal(health.databaseReady, true); assert.equal(health.ready, false);
  assert.equal(health.paymentEnabled, false); assert.equal(health.modelConfigured, false);
  assert.equal(health.workspaceAdapterReady, true); assert.equal(health.reportAdapterReady, true);
  assert.equal((await fetch(origin + '/livez')).status, 200);
  const readiness = await fetch(origin + '/readyz');
  assert.equal(readiness.status, 200);
  assert.equal((await readiness.json()).ready, true, 'Disabled payments must not invalidate service readiness');
  assert.equal((await runtime.planner.plan({})).code, 'MODEL_NOT_CONFIGURED');
  process.stdout.write('Non-root image: Node/Python imports, workspace, private routes and disabled payment guards verified.\n');
} finally {
  const closed = await runtime.close();
  assert.equal(closed.drained, true); assert.equal(closed.storeClosed, true);
}
