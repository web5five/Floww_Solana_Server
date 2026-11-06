import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PROTOCOL = 'floww-adapter-preflight/v1', MAX_OUTPUT = 1024;
const SCRIPT = `import importlib,json
def available(name):
    try:
        module=importlib.import_module(name)
        return callable(getattr(module,'handle',None)) and callable(getattr(module,'main',None))
    except BaseException:
        return False
workspace=available('ai_baseline.workspace_cli')
report=available('ai_baseline.integration_cli')
print(json.dumps({'protocol':'${PROTOCOL}','workspaceAdapterReady':workspace,'reportAdapterReady':report},separators=(',',':')))
`;

/** Only a trusted programmatic caller can supply this exact DI snapshot. */
export function freezeAdapterStatus(value) {
  const fields = ['workspaceAdapterReady', 'reportAdapterReady'];
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Reflect.ownKeys(value).length !== fields.length || Reflect.ownKeys(value).some(name => !fields.includes(name)) ||
      fields.some(name => typeof Object.getOwnPropertyDescriptor(value, name)?.value !== 'boolean')) {
    throw new TypeError('INVALID_ADAPTER_STATUS');
  }
  return Object.freeze(Object.fromEntries(fields.map(name => [name, Object.getOwnPropertyDescriptor(value, name).value])));
}
export const UNAVAILABLE_ADAPTER_STATUS = freezeAdapterStatus({ workspaceAdapterReady: false, reportAdapterReady: false });

/** Local packaging only: no adapter function, model, key or network is invoked. */
export async function checkPythonAdapters({ python = 'python3', timeoutMs = 2000, signal } = {}) {
  if (typeof python !== 'string' || !python || python.includes('\0') ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2000 ||
      (signal !== undefined && !(signal instanceof AbortSignal))) throw new TypeError('INVALID_ADAPTER_PREFLIGHT_CONFIG');
  if (signal?.aborted) return UNAVAILABLE_ADAPTER_STATUS;
  return new Promise(resolve => {
    let child, finished = false, size = 0, chunks = [], timer;
    const ignore = () => {};
    const finish = (result, kill = false) => {
      if (finished) return;
      finished = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      chunks = [];
      if (kill && child) {
        // Never wait for a stuck close event or inherited pipe to end startup.
        try { child.kill('SIGKILL'); } catch { /* fixed failure, no diagnostics */ }
        for (const stream of [child.stdin, child.stdout, child.stderr]) {
          stream?.removeAllListeners('data'); stream?.destroy();
        }
        child.unref();
      }
      resolve(result);
    };
    const stop = () => finish(UNAVAILABLE_ADAPTER_STATUS, true);
    const abort = stop;
    timer = setTimeout(stop, timeoutMs);
    try {
      child = spawn(python, ['-c', SCRIPT], {
        cwd: ROOT, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        env: { PATH: process.env.PATH ?? '', LANG: 'C.UTF-8', PYTHONPATH: path.join(ROOT, 'reference'),
          PYTHONDONTWRITEBYTECODE: '1', PYTHONNOUSERSITE: '1' },
      });
    } catch { stop(); return; }
    child.on('error', stop);
    for (const stream of [child.stdout, child.stderr]) stream.on('error', ignore);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { stop(); return; }
    const output = (chunk, retain) => {
      if (finished) return;
      size += chunk.length;
      if (size > MAX_OUTPUT) { stop(); return; }
      if (retain) chunks.push(chunk);
    };
    child.stdout.on('data', chunk => output(chunk, true));
    child.stderr.on('data', chunk => output(chunk, false));
    child.on('close', code => {
      if (finished) return;
      if (code !== 0) { finish(UNAVAILABLE_ADAPTER_STATUS); return; }
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value) ||
            Object.keys(value).length !== 3 || Object.keys(value).some(name => !['protocol', 'workspaceAdapterReady', 'reportAdapterReady'].includes(name)) ||
            !Object.hasOwn(value, 'protocol') || value.protocol !== PROTOCOL ||
            !Object.hasOwn(value, 'workspaceAdapterReady') || !Object.hasOwn(value, 'reportAdapterReady')) throw new Error();
        finish(freezeAdapterStatus({ workspaceAdapterReady: value.workspaceAdapterReady, reportAdapterReady: value.reportAdapterReady }));
      } catch { finish(UNAVAILABLE_ADAPTER_STATUS); }
    });
  });
}
