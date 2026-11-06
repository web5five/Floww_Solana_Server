import { ServiceError } from './config.mjs';

export async function readBounded(response, limit = 256_000) {
  if (!response.body) return '';
  const reader = response.body.getReader(); let size = 0; const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new ServiceError('RESPONSE_TOO_LARGE', 502); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString('utf8');
}
export function createRpc(rpcUrl, { fetchImpl = fetch, timeoutMs = 12000 } = {}) {
  let id = 0;
  return async (method, params, { signal: callerSignal } = {}) => {
    try {
      // A report/request deadline must cancel every nested RPC as well as the
      // per-call deadline. Do not send a request that was already cancelled.
      const signal = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(callerSignal ? [callerSignal] : [])]);
      signal.throwIfAborted();
      const response = await fetchImpl(rpcUrl, { method: 'POST', redirect: 'error', signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
      if (!response.ok) throw new Error('status');
      const value = JSON.parse(await readBounded(response, 2_000_000));
      signal.throwIfAborted();
      if (value.error || !Object.hasOwn(value, 'result')) throw new Error('rpc');
      return value.result;
    } catch { throw new ServiceError('RPC_UNAVAILABLE', 503); }
  };
}
