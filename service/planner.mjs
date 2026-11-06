import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const MAX_INPUT = 64_000, MAX_OUTPUT = 16_000, MAX_PROCESSES = 2;
let active = 0;
const RESOURCE = 'wallet-transfers', PROMPT = 'workspace/v2';
const FIELDS = ['purpose', 'wallet', 'windowStart', 'windowEnd', 'resourceId', 'missingFields'];
const CODES = new Set(['MODEL_NOT_CONFIGURED', 'WORKSPACE_INVALID_INPUT', 'WORKSPACE_INPUT_TOO_LARGE',
  'WORKSPACE_INVALID_MODEL_OUTPUT', 'WORKSPACE_STALE_CONTEXT', 'WORKSPACE_SCOPE_REQUIRED',
  'WORKSPACE_PLAN_REJECTED', 'WORKSPACE_MODEL_UNAVAILABLE', 'WORKSPACE_TIMEOUT',
  'WORKSPACE_CANCELLED', 'WORKSPACE_PROCESS_FAILED', 'WORKSPACE_OUTPUT_TOO_LARGE',
  'WORKSPACE_RESOURCE_UNAVAILABLE', 'WORKSPACE_BUSY']);
const fail = code => ({ status: 'STOPPED', code });
const exact = (value, fields) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === fields.length && Object.keys(value).every(key => fields.includes(key));
const secret = /(?:sk-[A-Za-z0-9_-]{12,}|\bBearer\s+\S+|-----BEGIN[^\n]*PRIVATE KEY-----)/i;
const url = /(?:[a-z][a-z0-9+.-]*:\/\/|\bwww\.|\b(?:javascript|data|mailto):\S|(?<!:)\/\/[A-Za-z0-9])/i;
const authority = /(?:\b(?:sign|broadcast|execute|send|pay|approve)\b[\s\S]{0,50}\b(?:transactions?|payments?|funds?|tokens?|purchases?|USDC|SOL)\b|execute_payment|sign_transaction|sendTransaction|auto_approve|private_key|api_key|paymentHeader|자동.{0,12}(?:결제|승인|서명)|(?:서명|송금|결제)(?:하세요|하라|하겠|합니다|해라))/i;
const text = (value, limit) => typeof value === 'string' && value.trim() && value.length <= limit
  && !/[\x00-\x08\x0b-\x1f\x7f]/.test(value) && !secret.test(value) && !url.test(value) && !authority.test(value);
function containsKey(item, key) {
  const pending = [item];
  while (pending.length) {
    const value = pending.pop();
    if (typeof value === 'string' && value.includes(key)) return true;
    if (value && typeof value === 'object') {
      for (const [name, nested] of Object.entries(value)) {
        if (name.includes(key)) return true;
        pending.push(nested);
      }
    }
  }
  return false;
}

function intentValid(intent) {
  if (!exact(intent, FIELDS) || !Array.isArray(intent.missingFields) || intent.missingFields.length > 5
      || new Set(intent.missingFields).size !== intent.missingFields.length
      || intent.missingFields.some(field => !FIELDS.slice(0, -1).includes(field))) return false;
  const missing = FIELDS.slice(0, -1).filter(field => intent[field] === null);
  if (missing.length !== intent.missingFields.length || missing.some(field => !intent.missingFields.includes(field))) return false;
  return (intent.purpose === null || text(intent.purpose, 2_000))
    && (intent.wallet === null || (typeof intent.wallet === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(intent.wallet)))
    && ['windowStart', 'windowEnd'].every(field => intent[field] === null
      || (typeof intent[field] === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(intent[field])
        && Number.isFinite(Date.parse(intent[field]))))
    && (intent.resourceId === null || intent.resourceId === RESOURCE);
}

function validateResult(value, operation, model, apiKey) {
  // Even a misconfigured executable must not echo credentials through a field
  // that happens to fit the result schema. Diagnostics are always fixed codes.
  if (apiKey && containsKey(value, apiKey)) return false;
  if (exact(value, ['status', 'code']) && value.status === 'STOPPED' && CODES.has(value.code)) return true;
  const metadata = ['executionKind', 'modelVersion', 'promptVersion'];
  if (value?.modelVersion !== model || value?.promptVersion !== PROMPT) return false;
  if (operation === 'refine') {
    return exact(value, ['status', 'assistantText', 'intent', ...metadata])
      && ['READY_TO_PLAN', 'CLARIFICATION_REQUIRED', 'UNSUPPORTED'].includes(value.status)
      && value.executionKind === 'live_model_intent_refinement' && text(value.assistantText, 800)
      && intentValid(value.intent) && (value.status !== 'READY_TO_PLAN' || value.intent.missingFields.length === 0);
  }
  return exact(value, ['status', 'summary', 'steps', 'limitations', ...metadata])
    && value.status === 'PROPOSED' && value.executionKind === 'live_model_planner_critic' && text(value.summary, 800)
    && Array.isArray(value.steps) && value.steps.length >= 1 && value.steps.length <= 3
    && value.steps.every(step => exact(step, ['role', 'capability', 'resourceId', 'reason'])
      && step.role === 'planner' && step.capability === RESOURCE && step.resourceId === RESOURCE && text(step.reason, 512))
    && new Set(value.steps.map(step => step.resourceId)).size === value.steps.length
    && Array.isArray(value.limitations) && value.limitations.length >= 1 && value.limitations.length <= 6
    && value.limitations.every(item => text(item, 512));
}

/** No payment port exists. Two processes maximum; each has a hard total deadline. */
export function createPlanner({ python = 'python3', model, apiKey, timeoutMs = 25_000 } = {}) {
  if (typeof python !== 'string' || !python || python.includes('\0') || !Number.isInteger(timeoutMs)
      || timeoutMs < 1 || timeoutMs > 120_000
      || (model !== undefined && model !== null && model !== ''
        && (typeof model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(model) || url.test(model)))
      || (apiKey !== undefined && apiKey !== null && apiKey !== ''
        && (typeof apiKey !== 'string' || !/^[!-~]{1,512}$/.test(apiKey)))) throw new Error('INVALID_PLANNER_CONFIG');
  async function run(operation, payload, { signal } = {}) {
    if (!model || !apiKey) return fail('MODEL_NOT_CONFIGURED');
    if (signal !== undefined && !(signal instanceof AbortSignal)) return fail('WORKSPACE_INVALID_INPUT');
    let input;
    try { input = JSON.stringify(payload); } catch { return fail('WORKSPACE_INVALID_INPUT'); }
    if (input === undefined || Buffer.byteLength(input) > MAX_INPUT) return fail('WORKSPACE_INPUT_TOO_LARGE');
    if (containsKey(JSON.parse(input), apiKey)) return fail('WORKSPACE_INVALID_INPUT');
    if (signal?.aborted) return fail('WORKSPACE_CANCELLED');
    if (active >= MAX_PROCESSES) return fail('WORKSPACE_BUSY');
    active++;
    return new Promise(resolve => {
      let child, done = false, errorCode, size = 0, chunks = [];
      const finish = value => {
        if (done) return;
        done = true; active--; clearTimeout(timer); signal?.removeEventListener('abort', abort); resolve(value);
      };
      const stop = code => { if (!errorCode) errorCode = code; child?.kill('SIGKILL'); };
      const abort = () => stop('WORKSPACE_CANCELLED');
      const timer = setTimeout(() => stop('WORKSPACE_TIMEOUT'), timeoutMs); timer.unref();
      try {
        child = spawn(python, ['-m', 'ai_baseline.workspace_cli', operation], {
          cwd: ROOT, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
          env: { PATH: process.env.PATH ?? '', LANG: 'C.UTF-8',
            PYTHONPATH: path.join(ROOT, 'reference'), PYTHONDONTWRITEBYTECODE: '1', PYTHONNOUSERSITE: '1',
            FLOWW_AI_MODEL: model, FLOWW_AI_API_KEY: apiKey, FLOWW_WORKSPACE_BUDGET_MS: String(timeoutMs) },
        });
      } catch { finish(fail('WORKSPACE_PROCESS_FAILED')); return; }
      signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
      child.on('error', () => finish(fail('WORKSPACE_PROCESS_FAILED')));
      child.stdout.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_OUTPUT) { chunks = []; stop('WORKSPACE_OUTPUT_TOO_LARGE'); }
        else if (!errorCode) chunks.push(chunk);
      });
      child.stderr.on('data', () => {}); child.stdin.on('error', () => {});
      child.on('close', code => {
        if (errorCode) { finish(fail(errorCode)); return; }
        if (code !== 0) { finish(fail('WORKSPACE_PROCESS_FAILED')); return; }
        try {
          const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          finish(validateResult(value, operation, model, apiKey) ? value : fail('WORKSPACE_INVALID_MODEL_OUTPUT'));
        } catch { finish(fail('WORKSPACE_INVALID_MODEL_OUTPUT')); }
      });
      child.stdin.end(input);
    });
  }
  return { refine: (payload, options) => run('refine', payload, options),
    plan: (payload, options) => run('plan', payload, options) };
}
