import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { checkPythonAdapters, freezeAdapterStatus, UNAVAILABLE_ADAPTER_STATUS } from '../service/adapter-preflight.mjs';
import { loadConfig } from '../service/config.mjs';
import { start } from '../service/main.mjs';
import { Store } from '../service/store.mjs';

const PROTOCOL = 'floww-adapter-preflight/v1';
const ready = { workspaceAdapterReady: true, reportAdapterReady: true };
const executable = spawnSync('python3', ['-c', 'import sys;print(sys.executable)'], { encoding: 'utf8' }).stdout.trim();
assert.ok(executable && !/[\r\n]/.test(executable), 'Actual Python executable is required for packaging acceptance');
const protocol = value => JSON.stringify({ protocol: PROTOCOL, ...value });
async function directory(t) {
  const value = await mkdtemp(path.join(os.tmpdir(), 'floww-adapter-preflight-'));
  t.after(() => rm(value, { recursive: true, force: true })); return value;
}
async function wrapper(dir, name, source) {
  const file = path.join(dir, name);
  await writeFile(file, '#!' + executable + '\n' + source + '\n'); await chmod(file, 0o700); return file;
}
const runProbe = 'exec(compile(sys.argv[2], "<fixed-preflight>", "exec"))';

test('actual credential-free adapters import with callable functions, without invoking either function', async t => {
  assert.deepEqual(await checkPythonAdapters(), ready);
  const dir = await directory(t);
  const python = await wrapper(dir, 'no-adapter-calls',
    'import sys,ai_baseline.workspace_cli,ai_baseline.integration_cli\n' +
    'def forbidden(*a,**k): raise AssertionError("Adapter functions must not run")\n' +
    'for m in (ai_baseline.workspace_cli,ai_baseline.integration_cli): m.handle=forbidden;m.main=forbidden\n' + runProbe);
  const result = await checkPythonAdapters({ python });
  assert.deepEqual(result, ready); assert.equal(Object.isFrozen(result), true);
});

for (const [module, field] of [['workspace_cli', 'workspaceAdapterReady'], ['integration_cli', 'reportAdapterReady']]) {
  test('an unavailable ' + module + ' does not suppress the other adapter import', async t => {
    const python = await wrapper(await directory(t), 'missing-' + module,
      'import sys,importlib\noriginal=importlib.import_module\n' +
      'def load(name,*a,**k):\n' +
      '    if name=="ai_baseline.' + module + '": raise ImportError("private-import-details")\n' +
      '    return original(name,*a,**k)\nimportlib.import_module=load\n' + runProbe);
    assert.deepEqual(await checkPythonAdapters({ python }), { ...ready, [field]: false });
  });
}

test('non-callable adapter functions fail only the affected capability', async t => {
  const python = await wrapper(await directory(t), 'not-callable',
    'import sys,ai_baseline.workspace_cli\nai_baseline.workspace_cli.handle=None\n' + runProbe);
  assert.deepEqual(await checkPythonAdapters({ python }), { ...ready, workspaceAdapterReady: false });
});

test('child environment excludes credentials, inherited Python hooks and unrelated runtime values', async t => {
  const keys = ['OPENAI_API_KEY', 'FLOWW_AI_API_KEY', 'DATABASE_URL', 'FLOWW_PAYER_KEY_FILE', 'PYTHONSTARTUP', 'HTTP_PROXY'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const key of keys) process.env[key] = 'private-preflight-marker';
  try {
    const python = await wrapper(await directory(t), 'environment',
      'import sys,os\nassert not any(k in os.environ for k in ' + JSON.stringify(keys) + ')\n' +
      'assert os.environ["PYTHONDONTWRITEBYTECODE"]=="1"\nassert os.environ["PYTHONNOUSERSITE"]=="1"\n' +
      'assert set(os.environ).issubset({"PATH","LANG","LC_CTYPE","PYTHONPATH","PYTHONDONTWRITEBYTECODE","PYTHONNOUSERSITE","__CF_USER_TEXT_ENCODING"})\n' + runProbe);
    assert.deepEqual(await checkPythonAdapters({ python }), ready);
  } finally {
    for (const key of keys) if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
  }
});

test('snapshot injection requires exact own boolean fields and copies them immutably', () => {
  const input = { ...ready }, frozen = freezeAdapterStatus(input); input.reportAdapterReady = false;
  assert.deepEqual(frozen, ready); assert.equal(Object.isFrozen(frozen), true);
  for (const bad of [undefined, null, [], {}, { ...ready, extra: true }, { ...ready, reportAdapterReady: 'true' },
    Object.assign(Object.create({ reportAdapterReady: true }), { workspaceAdapterReady: true, extra: 0 }),
    { ...ready, [Symbol('hidden')]: true }, Object.defineProperty({ ...ready }, 'extra', { value: true }),
    { workspaceAdapterReady: true, get reportAdapterReady() { throw new Error('must-not-read-accessor'); } }]) {
    assert.throws(() => freezeAdapterStatus(bad), { message: 'INVALID_ADAPTER_STATUS' });
  }
});

test('invalid executable, deadline and signal options fail with a fixed configuration error', async () => {
  for (const options of [{ python: null }, { python: 'bad\0path' }, { timeoutMs: 0 }, { timeoutMs: 2001 }, { signal: {} }]) {
    await assert.rejects(checkPythonAdapters(options), { message: 'INVALID_ADAPTER_PREFLIGHT_CONFIG' });
  }
});

test('missing executable and nonzero exit never expose diagnostics or partial success', async t => {
  const dir = await directory(t);
  assert.deepEqual(await checkPythonAdapters({ python: path.join(dir, 'does-not-exist') }), UNAVAILABLE_ADAPTER_STATUS);
  const python = await wrapper(dir, 'failed-exit', 'import sys\nprint(' + JSON.stringify(protocol(ready)) + ')\nprint("private-diagnostic",file=sys.stderr)\nsys.exit(7)');
  const result = await checkPythonAdapters({ python });
  assert.deepEqual(result, UNAVAILABLE_ADAPTER_STATUS); assert.doesNotMatch(JSON.stringify(result), /private|diagnostic|failed-exit/);
});

for (const [name, value] of [
  ['invalid-json', 'private-not-json'], ['wrong-version', JSON.stringify({ protocol: 'other', ...ready })],
  ['missing-field', JSON.stringify({ protocol: PROTOCOL, workspaceAdapterReady: true })],
  ['extra-field', JSON.stringify({ protocol: PROTOCOL, ...ready, privateDiagnostic: 'secret' })],
  ['non-boolean', protocol({ workspaceAdapterReady: true, reportAdapterReady: 1 })],
]) test('strict protocol rejects ' + name, async t => {
  const python = await wrapper(await directory(t), name, 'print(' + JSON.stringify(value) + ')');
  assert.deepEqual(await checkPythonAdapters({ python }), UNAVAILABLE_ADAPTER_STATUS);
});

for (const [name, output] of [
  ['stdout', 'sys.stdout.write("x"*1025);sys.stdout.flush()'],
  ['stderr', 'sys.stderr.write("private"*200);sys.stderr.flush()'],
  ['combined', 'sys.stdout.write("x"*600);sys.stdout.flush();sys.stderr.write("y"*600);sys.stderr.flush()'],
]) test('combined output bound terminates excessive ' + name + ' without waiting for child exit', async t => {
  const python = await wrapper(await directory(t), 'excess-' + name, 'import sys,time\n' + output + '\ntime.sleep(10)');
  const begin = performance.now();
  assert.deepEqual(await checkPythonAdapters({ python, timeoutMs: 1000 }), UNAVAILABLE_ADAPTER_STATUS);
  assert.ok(performance.now() - begin < 1500, 'bounded output failure must settle promptly');
});

test('deadline settles even when a descendant holds stdout/stderr open after the owned child exits', async t => {
  const dir = await directory(t), pidFile = path.join(dir, 'owned-test-descendant');
  const python = await wrapper(dir, 'held-pipes', 'import sys,subprocess\n' +
    'p=subprocess.Popen([sys.executable,"-c","import time;time.sleep(10)"],stdout=sys.stdout,stderr=sys.stderr)\n' +
    'open(' + JSON.stringify(pidFile) + ',"w").write(str(p.pid))\n' +
    'print(' + JSON.stringify(protocol(ready)) + ',flush=True)');
  const begin = performance.now();
  try {
    assert.deepEqual(await checkPythonAdapters({ python, timeoutMs: 500 }), UNAVAILABLE_ADAPTER_STATUS);
    assert.ok(performance.now() - begin < 1500, 'inherited pipes must not extend the whole deadline');
    assert.ok(Number(await readFile(pidFile, 'utf8')) > 0, 'the held-pipe descendant actually started');
  } finally {
    // Clean up this fixture's descendant before its private PID file is removed.
    try { process.kill(Number(await readFile(pidFile, 'utf8')), 'SIGKILL'); } catch { /* already exited */ }
  }
});

test('pre-aborted and active cancellation settle fail-closed without retaining child work', async t => {
  const dir = await directory(t), marker = path.join(dir, 'started');
  const python = await wrapper(dir, 'cancel', 'import time\nopen(' + JSON.stringify(marker) + ',"w").write("started")\ntime.sleep(10)');
  const before = new AbortController(); before.abort();
  assert.deepEqual(await checkPythonAdapters({ python, signal: before.signal }), UNAVAILABLE_ADAPTER_STATUS);
  await assert.rejects(readFile(marker), { code: 'ENOENT' });
  const active = new AbortController(), begin = performance.now();
  const result = checkPythonAdapters({ python, timeoutMs: 1000, signal: active.signal });
  let started = false;
  try {
    for (let i = 0; i < 100; i++) {
      try { started = (await readFile(marker, 'utf8')) === 'started'; } catch { /* child has not started */ }
      if (started) break;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.equal(started, true, 'cancellation is exercised after the child actually starts');
  } finally { active.abort(); }
  assert.deepEqual(await result, UNAVAILABLE_ADAPTER_STATUS);
  assert.ok(performance.now() - begin < 800, 'cancellation must not wait for the configured timeout');
});

test('runtime caches one actual offline process across health/probes and no-key planner requests', async t => {
  const dir = await directory(t), counter = path.join(dir, 'spawn-count');
  const python = await wrapper(dir, 'count', 'import sys\nopen(' + JSON.stringify(counter) + ',"a").write("1\\n")\n' + runProbe);
  const runtime = await start({ config: { ...loadConfig({ FLOWW_PYTHON: python }), port: 0 }, store: new Store(':memory:'), writeLog: () => true });
  t.after(() => runtime.close());
  const origin = 'http://127.0.0.1:' + runtime.server.address().port;
  const request = value => new Promise((resolve, reject) => {
    const req = httpRequest(origin + value, { headers: { Host: new URL(runtime.config.origin).host } }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
    });
    req.once('error', reject); req.setTimeout(5000, () => req.destroy(new Error('Test request timed out'))); req.end();
  });
  for (let i = 0; i < 4; i++) {
    const observed = await request('/api/health'); assert.equal(observed.status, 200);
    const health = observed.body;
    assert.equal(health.workspaceAdapterReady, true); assert.equal(health.reportAdapterReady, true);
    assert.equal(health.modelConfigured, false); assert.equal(health.ready, false);
    assert.equal((await request('/readyz')).status, 200);
    assert.equal((await request('/livez')).status, 200);
  }
  assert.equal((await runtime.planner.plan({})).code, 'MODEL_NOT_CONFIGURED');
  assert.equal((await runtime.planner.refine({})).code, 'MODEL_NOT_CONFIGURED');
  assert.equal(await readFile(counter, 'utf8'), '1\n');
  assert.equal(Object.isFrozen(runtime.adapterStatus), true);
  assert.equal(runtime.adapterStatus, runtime.app.locals.adapterStatus);
});
