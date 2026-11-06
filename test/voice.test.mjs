import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { setupVoice, wav } from './voice-helpers.mjs';

test('real signed HTTP raw WAV bypasses only the JSON parser and returns an unsaved editable transcript', async () => {
  const f = await setupVoice();
  try {
    const user = await f.login(), conversation = await f.conversation(user.cookie);
    const before = await f.workspace.get(user.keys.wallet, 'conversation', conversation.id), id = randomUUID();
    const result = await f.raw(user.cookie, conversation, { captureId: id.toUpperCase() });
    assert.equal(result.status, 200); assert.deepEqual(result.body, { version: 'voice-transcript/v1', captureId: id,
      conversationId: conversation.id, revision: conversation.revision, languageHint: 'ko', durationMs: 1000, text: '테스트 음성 입력' });
    assert.equal(result.headers.get('permissions-policy'), 'camera=(), microphone=(self), geolocation=()');
    assert.deepEqual(await f.workspace.get(user.keys.wallet, 'conversation', conversation.id), before);
    assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM tasks').get().n, 0);
    assert.deepEqual(f.quota().map(row => row.used), [1, 1, 1, 1]);
    assert.equal(f.store.db.prepare("SELECT count(*) AS n FROM workspace_model_usage WHERE bucket NOT LIKE 'voice:v1:%'").get().n, 0);
    assert.equal((await f.raw(user.cookie, conversation, { captureId: id })).body.error.code, 'VOICE_CAPTURE_REPLAY');
    assert.deepEqual(f.calls(), { provider: 1, forbidden: 0 });
    const tooBigJSON = await f.request('/api/conversations', { method: 'POST', cookie: user.cookie, body: { title: 'x'.repeat(20_000) } });
    assert.equal(tooBigJSON.status, 413);
  } finally { await f.close(); }
});
test('authenticated capabilities/configuration do not claim provider availability or use Responses credentials', async () => {
  for (const options of [{ enabled: false }, { configured: false, configChanges: { model: 'scripted-text', apiKey: 'scripted-responses-only' } }]) {
    const f = await setupVoice(options);
    try {
      assert.equal((await f.request('/api/voice/capabilities')).status, 401);
      const user = await f.login(), conversation = await f.conversation(user.cookie);
      const caps = await f.request('/api/voice/capabilities', { cookie: user.cookie });
      assert.equal(caps.status, 200); assert.equal(caps.body.model, 'gpt-transcribe'); assert.equal(caps.body.maxBytes, 1_920_044);
      assert.equal(caps.body.enabled, options.enabled !== false); assert.equal(caps.body.configured, options.configured !== false);
      const result = await f.raw(user.cookie, conversation);
      assert.equal(result.status, 503); assert.equal(result.body.error.code, options.enabled === false ? 'VOICE_DISABLED' : 'VOICE_NOT_CONFIGURED');
      assert.equal(result.headers.get('permissions-policy'), 'camera=(), microphone=(), geolocation=()');
      assert.equal(f.quota().length, 0); assert.deepEqual(f.calls(), { provider: 0, forbidden: 0 });
      const health = await f.request('/api/health'); assert.equal(health.body.voiceConfigured, options.configured !== false);
      assert.equal(health.body.ready, false);
    } finally { await f.close(); }
  }
});
test('Host/Origin/auth/metadata/type/consent and malformed audio fail before voice quota or provider', async () => {
  const f = await setupVoice();
  try {
    const user = await f.login(), conversation = await f.conversation(user.cookie);
    for (const [changed, expected] of [[{ Origin: 'https://other.example' }, 403], [{ Cookie: 'floww_session=invalid' }, 401],
      [{ 'X-Floww-Voice-Consent': 'false' }, 400], [{ 'X-Floww-Language': 'auto' }, 400], [{ 'X-Floww-Expected-Revision': '0' }, 400],
      [{ 'Content-Type': 'audio/webm' }, 415], [{ 'Content-Encoding': 'gzip' }, 415]]) {
      assert.equal((await f.raw(user.cookie, conversation, { headers: changed })).status, expected);
    }
    const high = wav(); high[0] |= 0x80;
    for (const audio of [Buffer.from('not a canonical WAV recording'), wav(16000, true), high]) assert.equal((await f.raw(user.cookie, conversation, { audio })).status, 422);
    assert.equal(f.quota().length, 0); assert.deepEqual(f.calls(), { provider: 0, forbidden: 0 });
  } finally { await f.close(); }
});
test('owned unlinked revision is checked without normalizing or mutating an existing financial Task', async () => {
  const f = await setupVoice();
  try {
    const user = await f.login(), other = await f.login(), conversation = await f.conversation(user.cookie);
    assert.equal((await f.raw(other.cookie, conversation)).status, 404);
    assert.equal((await f.raw(user.cookie, { ...conversation, revision: conversation.revision + 1 })).body.error.code, 'WORKSPACE_CHANGED');
    f.store.add({ id: conversation.id, owner: user.keys.wallet, policy: 'ALLOW', payment: 'SIGNING', delivery: 'PENDING',
      operation: { id: randomUUID(), expiresAt: 1 }, events: [], workspaceContext: { conversationId: conversation.id }, signedData: { proof: 'scripted-private' } });
    const before = f.store.db.prepare('SELECT revision,data FROM tasks WHERE id=?').get(conversation.id);
    const result = await f.raw(user.cookie, conversation); assert.equal(result.status, 409); assert.equal(result.body.error.code, 'CONVERSATION_ALREADY_LINKED');
    assert.deepEqual(f.store.db.prepare('SELECT revision,data FROM tasks WHERE id=?').get(conversation.id), before);
    assert.equal(f.quota().length, 0); assert.deepEqual(f.calls(), { provider: 0, forbidden: 0 });
  } finally { await f.close(); }
});
test('daily voice admission is independent and failures after reservation do not refund', async () => {
  const f = await setupVoice({ configChanges: { voiceDailyCalls: 1, voiceOwnerDailyCalls: 1 } });
  try {
    const user = await f.login(), conversation = await f.conversation(user.cookie);
    f.control.call = async () => { throw new Error('private provider diagnostic'); };
    const result = await f.raw(user.cookie, conversation); assert.equal(result.status, 503);
    assert.doesNotMatch(JSON.stringify(result.body), /private provider/);
    assert.deepEqual(f.quota().map(row => row.used), [1, 1, 1, 1]);
    const denied = await f.raw(user.cookie, conversation); assert.equal(denied.status, 429); assert.equal(denied.body.error.code, 'VOICE_DAILY_LIMIT');
    assert.deepEqual(f.calls(), { provider: 1, forbidden: 0 });
  } finally { await f.close(); }
});
test('post-provider logout/expiry/context change withholds transcript while retaining only admissions', async () => {
  for (const mode of ['logout', 'expiry', 'context']) {
    const f = await setupVoice({ configChanges: { sessionTtlMs: 1000 } }); let complete, began;
    const started = new Promise(resolve => { began = resolve; });
    try {
      const user = await f.login(), conversation = await f.conversation(user.cookie);
      f.control.call = () => { began(); return new Promise(resolve => { complete = resolve; }); };
      const pending = f.raw(user.cookie, conversation); await started;
      if (mode === 'logout') await f.request('/api/auth/logout', { method: 'POST', cookie: user.cookie, body: {} });
      if (mode === 'expiry') f.advance(1001);
      if (mode === 'context') await f.workspace.update(user.keys.wallet, 'conversation', conversation.id, conversation.revision, data => { data.title = 'Changed'; });
      complete('private recognized transcript'); const result = await pending;
      assert.equal(result.status, mode === 'context' ? 409 : 401); assert.doesNotMatch(JSON.stringify(result.body), /private recognized/);
      assert.equal((await f.workspace.get(user.keys.wallet, 'conversation', conversation.id)).data.messages.length, 0);
      assert.deepEqual(f.quota().map(row => row.used), [1, 1, 1, 1]); assert.equal(f.calls().forbidden, 0);
    } finally { complete?.('late'); await f.close(); }
  }
});
test('logout or expiry during the final awaited context read cannot outlive the final auth decision', async () => {
  for (const mode of ['logout', 'expiry']) {
    const f = await setupVoice({ configChanges: { sessionTtlMs: 1000 } }); let unlock, arrived;
    const paused = new Promise(resolve => { arrived = resolve; }); const gate = new Promise(resolve => { unlock = resolve; });
    try {
      const user = await f.login(), conversation = await f.conversation(user.cookie);
      const original = f.workspace.voiceContext.bind(f.workspace); let reads = 0;
      f.workspace.voiceContext = async (...args) => { const value = await original(...args); if (++reads === 4) { arrived(); await gate; } return value; };
      const pending = f.raw(user.cookie, conversation); await paused;
      if (mode === 'logout') await f.request('/api/auth/logout', { method: 'POST', cookie: user.cookie, body: {} }); else f.advance(1001);
      unlock(); const result = await pending; assert.equal(result.status, 401); assert.equal(f.calls().provider, 1);
      assert.equal(f.quota().length, 4);
    } finally { unlock?.(); await f.close(); }
  }
});
test('client disconnection during initial slow auth consumes no audio quota or provider work', async () => {
  const f = await setupVoice(); let unlock, arrived;
  const paused = new Promise(resolve => { arrived = resolve; }), gate = new Promise(resolve => { unlock = resolve; });
  try {
    const user = await f.login(), conversation = await f.conversation(user.cookie), original = f.store.session.bind(f.store);
    let once = true; f.store.session = async token => { const value = original(token); if (once) { once = false; arrived(); await gate; } return value; };
    const controller = new AbortController(), pending = f.raw(user.cookie, conversation, { signal: controller.signal });
    await paused; controller.abort(); await assert.rejects(pending, error => error.name === 'AbortError');
    await new Promise(resolve => setTimeout(resolve, 10)); unlock(); await f.lifecycle.whenIdle();
    assert.equal(f.quota().length, 0); assert.deepEqual(f.calls(), { provider: 0, forbidden: 0 });
  } finally { unlock?.(); await f.close(); }
});
test('timed-out provider observation keeps real slots/work and refuses duplicate or replacement captures', async () => {
  const f = await setupVoice({ configChanges: { voiceProviderTimeoutMs: 20 } }); let complete;
  try {
    const user = await f.login(), conversation = await f.conversation(user.cookie), id = randomUUID();
    f.control.call = () => new Promise(resolve => { complete = resolve; });
    const result = await f.raw(user.cookie, conversation, { captureId: id });
    assert.equal(result.status, 504); assert.equal(result.body.error.code, 'VOICE_TIMEOUT');
    assert.equal(f.records[0].options.signal.aborted, true); assert.ok(f.lifecycle.counts().work > 0);
    const duplicate = await f.raw(user.cookie, conversation, { captureId: id.toUpperCase() }); assert.equal(duplicate.body.error.code, 'VOICE_CAPTURE_REPLAY');
    const replacement = await f.raw(user.cookie, conversation); assert.equal(replacement.status, 429); assert.equal(replacement.body.error.code, 'VOICE_BUSY');
    assert.equal(f.calls().provider, 1); complete('late transcript'); await f.lifecycle.whenIdle();
    f.control.call = null; assert.equal((await f.raw(user.cookie, conversation)).status, 200);
    assert.equal(f.calls().provider, 2); assert.equal(f.calls().forbidden, 0);
  } finally { complete?.('late'); await f.close(); }
});
test('drain aborts only subscribed voice work and waits for its actual provider settlement', async () => {
  const f = await setupVoice(); let complete, began; const started = new Promise(resolve => { began = resolve; });
  try {
    const user = await f.login(), conversation = await f.conversation(user.cookie);
    f.control.call = () => { began(); return new Promise(resolve => { complete = resolve; }); };
    const pending = f.raw(user.cookie, conversation); await started; f.lifecycle.beginDrain();
    const result = await pending; assert.equal(result.status, 503); assert.equal(result.body.error.code, 'SERVICE_DRAINING');
    assert.equal(f.records[0].options.signal.aborted, true); assert.ok(f.lifecycle.counts().work > 0);
    complete('late'); await f.lifecycle.whenIdle(); assert.equal(f.calls().forbidden, 0);
  } finally { complete?.('late'); await f.close(); }
});
test('real incomplete chunked upload reaches a fixed deadline before quota/provider admission', async () => {
  const f = await setupVoice({ configChanges: { voiceUploadTimeoutMs: 20 } }); let client;
  try {
    const user = await f.login(), conversation = await f.conversation(user.cookie);
    const result = await new Promise((resolve, reject) => {
      client = httpRequest(f.origin + '/api/voice/transcriptions', { method: 'POST', headers: f.headers(user.cookie, conversation) }, res => {
        const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
      });
      client.once('error', reject); client.write(wav().subarray(0, 30));
    });
    assert.equal(result.status, 408); assert.equal(result.body.error.code, 'VOICE_UPLOAD_TIMEOUT');
    assert.equal(f.quota().length, 0); assert.deepEqual(f.calls(), { provider: 0, forbidden: 0 });
  } finally { client?.destroy(); await f.close(); }
});
test('declared and chunked oversized HTTP audio plus wrong Host fail without quota/provider work', async () => {
  const f = await setupVoice(); const clients = [];
  try {
    const user = await f.login(), conversation = await f.conversation(user.cookie);
    const post = (changes, body, end = true) => new Promise((resolve, reject) => {
      let responded = false;
      const client = httpRequest(f.origin + '/api/voice/transcriptions', { method: 'POST', headers: { ...f.headers(user.cookie, conversation), ...changes } }, res => {
        responded = true; const chunks = []; res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
        res.once('error', reject);
      }); clients.push(client); client.on('error', error => { if (!responded) reject(error); });
      if (end) client.end(body); else client.write(body);
    });
    assert.equal((await post({ Host: 'wrong.example' }, wav())).status, 421);
    const declared = await post({ 'Content-Length': '1920045' }, Buffer.from('xx'), false);
    assert.equal(declared.status, 413); assert.equal(declared.body.error.code, 'VOICE_AUDIO_TOO_LARGE');
    const streamed = await post({ 'Transfer-Encoding': 'chunked' }, wav(960001)); assert.equal(streamed.status, 413); assert.equal(streamed.body.error.code, 'VOICE_AUDIO_TOO_LARGE');
    assert.equal(f.quota().length, 0); assert.deepEqual(f.calls(), { provider: 0, forbidden: 0 });
  } finally { for (const client of clients) client.destroy(); await f.close(); }
});
test('voice-specific global two-slot bound spans owners and request telemetry keeps no audio or transcript', async () => {
  const f = await setupVoice(), completions = []; let began;
  const started = new Promise(resolve => { began = resolve; });
  try {
    const users = await Promise.all([f.login(), f.login(), f.login()]);
    const conversations = await Promise.all(users.map(user => f.conversation(user.cookie)));
    f.control.call = () => new Promise(resolve => { completions.push(resolve); if (completions.length === 2) began(); });
    const pending = users.slice(0, 2).map((user, i) => f.raw(user.cookie, conversations[i])); await started;
    const denied = await f.raw(users[2].cookie, conversations[2]); assert.equal(denied.status, 429); assert.equal(denied.body.error.code, 'VOICE_BUSY');
    assert.equal(f.calls().provider, 2); for (const complete of completions) complete('private voice transcript sentinel');
    assert.ok((await Promise.all(pending)).every(result => result.status === 200));
    assert.doesNotMatch(JSON.stringify(f.telemetry.operatorSnapshot()), /private voice transcript|X-Floww|captureId|conversationId|audio\/wav|Cookie|Bearer/);
    assert.equal(f.calls().forbidden, 0);
  } finally { for (const complete of completions) complete('late'); await f.close(); }
});
test('final authorization can stop dispatch after reservation while admitted usage remains conservative', async () => {
  const f = await setupVoice();
  try {
    const user = await f.login(), conversation = await f.conversation(user.cookie), original = f.workspace.reserveVoice.bind(f.workspace);
    f.workspace.reserveVoice = async (...args) => {
      await original(...args); await f.request('/api/auth/logout', { method: 'POST', cookie: user.cookie, body: {} });
    };
    const result = await f.raw(user.cookie, conversation); assert.equal(result.status, 401);
    assert.deepEqual(f.quota().map(row => row.used), [1, 1, 1, 1]); assert.deepEqual(f.calls(), { provider: 0, forbidden: 0 });
  } finally { await f.close(); }
});
test('completed provider work does not mislabel a later guarded context lookup as a provider timeout', async () => {
  const f = await setupVoice({ configChanges: { voiceProviderTimeoutMs: 10 } });
  try {
    const user = await f.login(), conversation = await f.conversation(user.cookie), original = f.workspace.voiceContext.bind(f.workspace);
    let reads = 0; f.workspace.voiceContext = async (...args) => {
      const result = await original(...args); if (++reads === 4) await new Promise(resolve => setTimeout(resolve, 25)); return result;
    };
    const result = await f.raw(user.cookie, conversation); assert.equal(result.status, 200);
    assert.equal(f.records[0].options.signal.aborted, false); assert.equal(f.calls().provider, 1);
  } finally { await f.close(); }
});
