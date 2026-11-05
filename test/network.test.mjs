import test from 'node:test';
import assert from 'node:assert/strict';
import { createRpc } from '../service/network.mjs';

test('RPC respects an already cancelled report without sending a request', async () => {
  let calls = 0;
  const rpc = createRpc('https://rpc.example', { fetchImpl: async () => { calls++; } });
  await assert.rejects(rpc('getGenesisHash', [], { signal: AbortSignal.abort() }), { code: 'RPC_UNAVAILABLE' });
  assert.equal(calls, 0);
});

test('caller cancellation reaches an in-flight RPC and keeps raw diagnostics private', async () => {
  const controller = new AbortController(); let transportSignal;
  const rpc = createRpc('https://rpc.example', { fetchImpl: async (_url, options) => {
    transportSignal = options.signal;
    controller.abort(new Error('PRIVATE report detail'));
    transportSignal.throwIfAborted();
  } });
  await assert.rejects(rpc('getGenesisHash', [], { signal: controller.signal }), error =>
    error.code === 'RPC_UNAVAILABLE' && !String(error).includes('PRIVATE'));
  assert.equal(transportSignal.aborted, true);
});

test('per-RPC deadline still applies when the caller has a longer deadline', async () => {
  const rpc = createRpc('https://rpc.example', { timeoutMs: 10, fetchImpl: async (_url, options) =>
    new Promise((_resolve, reject) => {
      const keepAlive = setTimeout(() => reject(new Error('transport ignored cancellation')), 500);
      options.signal.addEventListener('abort', () => { clearTimeout(keepAlive); reject(options.signal.reason); }, { once: true });
    }) });
  await assert.rejects(rpc('getGenesisHash', [], { signal: new AbortController().signal }), { code: 'RPC_UNAVAILABLE' });
});

test('RPC checks cancellation again after reading a transport response', async () => {
  const controller = new AbortController();
  const rpc = createRpc('https://rpc.example', { fetchImpl: async () => {
    controller.abort();
    return new Response(JSON.stringify({ result: 'stale' }));
  } });
  await assert.rejects(rpc('getGenesisHash', [], { signal: controller.signal }), { code: 'RPC_UNAVAILABLE' });
});
