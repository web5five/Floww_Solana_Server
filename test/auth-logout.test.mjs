import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { getBase58Decoder } from '@solana/kit';
import { createApp } from '../service/app.mjs';
import { Store } from '../service/store.mjs';
import { loadConfig, ServiceError } from '../service/config.mjs';

function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function identity() {
  const keys = generateKeyPairSync('ed25519');
  return { ...keys, wallet: getBase58Decoder().decode(keys.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)) };
}
async function setup() {
  const directory = await mkdtemp('/tmp/floww-conditional-logout-');
  let now = Date.now(), deletions = 0, financial = 0;
  const rawStore = new Store(path.join(directory, 'state.sqlite'), { clock: () => now });
  const hooks = { afterSession: null, beforeLogout: null };
  const store = new Proxy(rawStore, { get(target, name) {
    if (name === 'session') return async token => { const session = target.session(token); await hooks.afterSession?.(session); return session; };
    if (name === 'logout') return async token => { await hooks.beforeLogout?.(); deletions++; return target.logout(token); };
    const value = target[name]; return typeof value === 'function' ? value.bind(target) : value;
  } });
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const config = { ...loadConfig({ FLOWW_PUBLIC_ORIGIN: origin }), sessionTtlMs: 60_000 };
  const forbidden = () => { financial++; throw new Error('No financial port in authentication tests'); };
  const app = createApp({ config, store, gateway: { readiness: forbidden, quote: forbidden, sign: forbidden, redeem: forbidden, reconcile: forbidden },
    adapterStatus: { workspaceAdapterReady: true, reportAdapterReady: true } });
  server.on('request', app);
  async function request(url, { cookie, method = 'GET', body, headers = {} } = {}) {
    const response = await fetch(origin + url, { method, headers: { ...(cookie ? { Cookie: cookie } : {}),
      ...(method !== 'GET' ? { Origin: origin, 'Content-Type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, headers: response.headers, body: response.status === 204 ? null : await response.json() };
  }
  async function login() {
    const keys = identity();
    const challenge = await request('/api/auth/challenge', { method: 'POST', body: { wallet: keys.wallet } });
    assert.equal(challenge.status, 200);
    const session = await request('/api/auth/verify', { method: 'POST', body: { wallet: keys.wallet,
      challengeId: challenge.body.challengeId, signature: sign(null, Buffer.from(challenge.body.message), keys.privateKey).toString('base64') } });
    assert.equal(session.status, 200);
    return { wallet: keys.wallet, cookie: session.headers.get('set-cookie').split(';')[0] };
  }
  const logout = (actor, expectedWallet) => request('/api/auth/logout', { method: 'POST', cookie: actor?.cookie, body: { expectedWallet } });
  return { request, login, logout, hooks, advance: ms => { now += ms; }, deletions: () => deletions,
    async close() { server.closeIdleConnections(); await new Promise(resolve => server.close(resolve)); await app.locals.lifecycle.whenIdle(); rawStore.close();
      await rm(directory, { recursive: true, force: true }); assert.equal(financial, 0); } };
}

test('conditional account-change logout revokes only its captured matching session and never sets a cookie', async () => {
  const f = await setup(); try {
    const a = await f.login(), b = await f.login();
    const revoked = await f.logout(a, a.wallet);
    assert.equal(revoked.status, 204); assert.equal(revoked.headers.has('set-cookie'), false);
    assert.equal((await f.request('/api/session', { cookie: a.cookie })).status, 401);
    assert.equal((await f.request('/api/session', { cookie: b.cookie })).body.wallet, b.wallet);
    assert.equal(f.deletions(), 1);
  } finally { await f.close(); }
});

test('a stale expected owner cannot revoke a replacement cookie or discover whether it exists', async () => {
  const f = await setup(); try {
    const a = await f.login(), b = await f.login();
    for (const actor of [b, null]) {
      const result = await f.logout(actor, a.wallet);
      assert.equal(result.status, 204); assert.equal(result.body, null); assert.equal(result.headers.has('set-cookie'), false);
    }
    assert.equal(f.deletions(), 0);
    assert.equal((await f.request('/api/session', { cookie: a.cookie })).body.wallet, a.wallet);
    assert.equal((await f.request('/api/session', { cookie: b.cookie })).body.wallet, b.wallet);
  } finally { await f.close(); }
});

for (const phase of ['afterSession', 'beforeLogout']) test('new sign-in survives an old conditional logout paused at ' + phase, async () => {
  const f = await setup(); const entered = deferred(), release = deferred();
  let pending;
  try {
    const a = await f.login(); let once = true;
    f.hooks[phase] = async () => { if (once) { once = false; entered.resolve(); await release.promise; } };
    pending = f.logout(a, a.wallet); await entered.promise;
    const b = await f.login(); release.resolve();
    const result = await pending;
    assert.equal(result.status, 204); assert.equal(result.headers.has('set-cookie'), false);
    assert.equal((await f.request('/api/session', { cookie: a.cookie })).status, 401);
    assert.equal((await f.request('/api/session', { cookie: b.cookie })).body.wallet, b.wallet);
    assert.equal(f.deletions(), 1);
  } finally { release.resolve(); await pending; await f.close(); }
});

test('explicit manual logout retains its existing cookie-clearing behavior', async () => {
  const f = await setup(); try {
    const a = await f.login();
    const result = await f.request('/api/auth/logout', { method: 'POST', cookie: a.cookie, body: {} });
    assert.equal(result.status, 204); assert.equal(result.headers.has('set-cookie'), true);
    assert.equal((await f.request('/api/session', { cookie: a.cookie })).status, 401);
  } finally { await f.close(); }
});

test('conditional logout keeps strict input and same-origin guards without revoking any session', async () => {
  const f = await setup(); try {
    const a = await f.login();
    for (const body of [{ expectedWallet: null }, { expectedWallet: '' }, { expectedWallet: a.wallet, owner: a.wallet }]) {
      assert.equal((await f.request('/api/auth/logout', { method: 'POST', cookie: a.cookie, body })).status, 400);
    }
    assert.equal((await f.request('/api/auth/logout', { method: 'POST', cookie: a.cookie, body: { expectedWallet: a.wallet }, headers: { Origin: 'https://other.example' } })).status, 403);
    assert.equal((await f.request('/api/session', { cookie: a.cookie })).status, 200); assert.equal(f.deletions(), 0);
  } finally { await f.close(); }
});

test('expired sessions and failed authority reads cannot clear a newer cookie', async () => {
  const f = await setup(); try {
    const a = await f.login(); f.advance(60_001);
    const expired = await f.logout(a, a.wallet);
    assert.equal(expired.status, 204); assert.equal(expired.headers.has('set-cookie'), false); assert.equal(f.deletions(), 0);
    const b = await f.login(); f.hooks.afterSession = () => { throw new ServiceError('STATE_UNAVAILABLE', 503); };
    const failed = await f.logout(b, b.wallet);
    assert.equal(failed.status, 503); assert.equal(failed.headers.has('set-cookie'), false); assert.equal(f.deletions(), 0);
    f.hooks.afterSession = null; assert.equal((await f.request('/api/session', { cookie: b.cookie })).status, 200);
  } finally { await f.close(); }
});
