import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const MAX_INPUT = 600_000;
const MAX_OUTPUT = 1_500_000;
const fail = code => ({ status: 'STOPPED', code });

/** A total-deadline, credential-minimized bridge to the existing Python gate. */
export function createAiBridge({ python = 'python3', timeoutMs = 20_000, model, apiKey } = {}) {
  if (typeof python !== 'string' || !python || python.includes('\0')
      || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000
      || (model !== undefined && (typeof model !== 'string' || model.length > 200))
      || (apiKey !== undefined && (typeof apiKey !== 'string' || apiKey.length > 512))) {
    throw new Error('INVALID_AI_CONFIG');
  }
  async function run(operation, payload, { signal } = {}) {
    let input;
    try { input = JSON.stringify(payload); } catch { return fail('AI_INVALID_INPUT'); }
    if (input === undefined || Buffer.byteLength(input) > MAX_INPUT) return fail('AI_INPUT_TOO_LARGE');
    if (signal?.aborted) return fail('AI_CANCELLED');
    return new Promise(resolve => {
      let child, done = false, errorCode, size = 0, chunks = [];
      const finish = result => {
        if (done) return;
        done = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
        resolve(result);
      };
      const stop = code => { errorCode = code; child?.kill('SIGKILL'); };
      const abort = () => stop('AI_CANCELLED');
      const timer = setTimeout(() => stop('AI_TIMEOUT'), timeoutMs);
      timer.unref();
      try {
        child = spawn(python, ['-m', 'ai_baseline.integration_cli', operation], {
          cwd: ROOT, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
          env: { PATH: process.env.PATH ?? '', LANG: 'C.UTF-8',
            PYTHONPATH: path.join(ROOT, 'reference'), PYTHONDONTWRITEBYTECODE: '1',
            FLOWW_AI_MODEL: model ?? '', FLOWW_AI_API_KEY: apiKey ?? '' },
        });
      } catch { finish(fail('AI_PROCESS_FAILED')); return; }
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      child.on('error', () => finish(fail('AI_PROCESS_FAILED')));
      child.stdout.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_OUTPUT) { chunks = []; stop('AI_OUTPUT_TOO_LARGE'); }
        else if (!errorCode) chunks.push(chunk);
      });
      // Drain diagnostics without retaining or exposing merchant input or keys.
      child.stderr.on('data', () => {});
      child.stdin.on('error', () => {});
      child.on('close', code => {
        if (errorCode) { finish(fail(errorCode)); return; }
        if (code !== 0) { finish(fail('AI_PROCESS_FAILED')); return; }
        try {
          const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!value || Array.isArray(value) || typeof value !== 'object'
              || !/^[A-Z][A-Z0-9_]{0,63}$/.test(value.status)
              || !/^[A-Z][A-Z0-9_]{0,63}$/.test(value.code)) throw new Error();
          finish(value);
        } catch { finish(fail('AI_INVALID_OUTPUT')); }
      });
      child.stdin.end(input);
    });
  }
  return {
    propose: (payload, options) => run('propose', payload, options),
    consume: (payload, options) => run('consume', payload, options),
  };
}
