import express from 'express';
import { createPublicKey, randomUUID, verify } from 'node:crypto';
import { getAddressEncoder } from '@solana/kit';
import { fileURLToPath } from 'node:url';
import { DEVNET, exact, fail, isAddress, ServiceError } from './config.mjs';
import { approve, assertApproval, attachQuote, makeTask, publicTask, resourceUrl,
  signature, termsHash, validateQuote } from './policy.mjs';

const safeCode = (value, fallback = 'INTEGRATION_UNAVAILABLE') =>
  typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(value) ? value : fallback;
const cookieValue = (header, name) => {
  const values = String(header || '').split(';').map(v => v.trim()).filter(v => v.startsWith(name + '='));
  return values.length === 1 ? values[0].slice(name.length + 1) : null;
};
function checkSignature(wallet, message, encoded) {
  try {
    if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(encoded)) return false;
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.length !== 64 || bytes.toString('base64') !== encoded) return false;
    const key = createPublicKey({ key: Buffer.concat([
      Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(getAddressEncoder().encode(wallet)),
    ]), format: 'der', type: 'spki' });
    return verify(null, Buffer.from(message, 'utf8'), key, bytes);
  } catch { return false; }
}
export function createApp({ config, store, gateway, ai, reportProvider, mountMerchant }) {
  if (config.network !== DEVNET) fail('DEVNET_ONLY', 500);
  const app = express(), expectedHost = new URL(config.origin).host;
  const now = () => store.clock();
  app.disable('x-powered-by'); app.disable('etag');
  app.use((req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()' });
    if (req.headers.host !== expectedHost) return next(new ServiceError('UNEXPECTED_HOST', 421));
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin !== config.origin) {
      return next(new ServiceError('ORIGIN_REQUIRED', 403));
    }
    if (req.method === 'OPTIONS') return res.sendStatus(405);
    next();
  });
  app.use('/api', express.json({ limit: '16kb', strict: true, type: 'application/json' }));
  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method) && !req.is('application/json')) return next(new ServiceError('JSON_REQUIRED', 415));
    next();
  });
  const token = req => cookieValue(req.headers.cookie, config.cookieName);
  const auth = async req => {
    const session = await store.session(token(req));
    // A database query can outlive the expiry supplied to its SQL predicate.
    if (!session || !Number.isFinite(session.expires) || session.expires <= now()) fail('AUTHENTICATION_REQUIRED', 401);
    return session;
  };
  const ready = async () => {
    try {
      const state = await gateway.readiness();
      return { ready: state?.ready === true && Boolean(config.merchantPayTo),
        missing: Array.isArray(state?.missing) ? state.missing.filter(x => typeof x === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(x)).map(x => ({
          payment_configuration: 'PAYMENT_CONFIGURATION', payment_enabled: 'FLOWW_ENABLE_DEVNET_PAYMENTS',
          payer_private_key: 'FLOWW_PAYER_KEY_FILE', valid_payer_private_key: 'FLOWW_PAYER_KEY_FILE',
        })[x] || x.toUpperCase()) : [],
        payer: isAddress(state?.payer) ? state.payer : null };
    } catch { return { ready: false, missing: ['PAYMENT_RUNTIME'], payer: null }; }
  };
  async function databaseReady() {
    let timer;
    try {
      await Promise.race([
        Promise.resolve().then(() => store.list('__floww_health__')),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error()), 2500); }),
      ]);
      return true;
    } catch { return false; }
    finally { clearTimeout(timer); }
  }
  app.get('/api/health', async (req, res) => {
    const [state, database] = await Promise.all([ready(), databaseReady()]);
    res.json({ ready: state.ready && database, network: config.network, mode: 'devnet', databaseReady: database,
      paymentEnabled: config.paymentEnabled, merchantConfigured: Boolean(config.merchantPayTo),
      payer: state.payer, missing: [...new Set([...state.missing, ...(!config.merchantPayTo ? ['MERCHANT_PAY_TO'] : []), ...(!database ? ['DATABASE_CONNECTION'] : [])])],
      modelConfigured: Boolean(config.model && config.apiKey) });
  });
  app.get('/api/session', async (req, res) => {
    const session = await auth(req); res.json({ wallet: session.wallet, expiresAt: new Date(session.expires).toISOString() });
  });
  app.post('/api/auth/challenge', async (req, res) => {
    exact(req.body, ['wallet']); if (!isAddress(req.body.wallet)) fail('INVALID_WALLET');
    res.json(await store.challenge(req.body.wallet, config.origin));
  });
  app.post('/api/auth/verify', async (req, res) => {
    exact(req.body, ['wallet', 'challengeId', 'signature']);
    if (!isAddress(req.body.wallet) || typeof req.body.challengeId !== 'string' || req.body.challengeId.length > 64) fail('INVALID_REQUEST');
    const session = await store.authenticate(req.body.challengeId, req.body.wallet,
      message => checkSignature(req.body.wallet, message, req.body.signature), config.sessionTtlMs);
    res.cookie(config.cookieName, session.token, { httpOnly: true, secure: config.secureCookies,
      sameSite: 'strict', path: '/', maxAge: config.sessionTtlMs });
    res.json({ wallet: session.wallet, expiresAt: new Date(session.expires).toISOString() });
  });
  app.post('/api/auth/logout', async (req, res) => {
    exact(req.body, []); await store.logout(token(req));
    res.clearCookie(config.cookieName, { httpOnly: true, secure: config.secureCookies, sameSite: 'strict', path: '/' }); res.sendStatus(204);
  });
  app.get('/api/tasks', async (req, res) => {
    const owner = (await auth(req)).wallet, tasks = await store.list(owner);
    await assertSession(req, owner); res.json({ tasks: tasks.map(publicTask) });
  });
  app.post('/api/tasks', async (req, res) => {
    const session = await auth(req), task = makeTask(req.body, session.wallet, now());
    store.event(task, 'TASK_CREATED', 'QUOTE_REQUIRED'); await store.add(task); await respondTask(req, res, task, session.wallet, 201);
  });
  app.get('/api/tasks/:id', async (req, res) => {
    const owner = (await auth(req)).wallet, task = await store.get(req.params.id, owner);
    await respondTask(req, res, task, owner);
  });

  async function begin(id, owner, kind, check) {
    const operation = { id: randomUUID(), kind, expiresAt: now() + 120_000 };
    const task = await store.mutate(id, owner, t => {
      if (t.operation) fail('TASK_BUSY', 409); check?.(t); t.operation = operation;
    });
    return { task, operation };
  }
  async function current(id, owner, operation) {
    const t = await store.get(id, owner);
    if (t.operation?.id !== operation.id || t.operation.expiresAt <= now()) fail('TASK_CHANGED', 409);
    return t;
  }
  async function finish(id, owner, operation, change) {
    return await store.mutate(id, owner, t => {
      if (t.operation?.id !== operation.id || t.operation.expiresAt <= now()) fail('TASK_CHANGED', 409);
      change(t); t.operation = null;
    });
  }
  async function release(id, owner, operation, error) {
    return await store.mutate(id, owner, t => {
      if (t.operation?.id !== operation.id) return;
      if (['SIGNING', 'PENDING'].includes(t.payment)) {
        t.payment = 'UNKNOWN'; t.reasonCode = 'PAYMENT_RECONCILIATION_REQUIRED'; t.nextAction = 'RECONCILE';
      } else {
        t.reasonCode = safeCode(error?.code);
        t.nextAction = t.payment === 'NOT_STARTED' ? 'QUOTE' : t.payment === 'CONFIRMED' ? 'RECOVER' : 'RECONCILE';
      }
      t.operation = null; store.event(t, 'OPERATION_STOPPED', t.reasonCode);
    });
  }
  async function assertSession(req, owner) { if ((await auth(req)).wallet !== owner) fail('AUTHENTICATION_REQUIRED', 401); }
  async function respondTask(req, res, task, owner, status = 200) {
    await assertSession(req, owner);
    res.status(status).json(publicTask(task));
  }
  function noExecution(task) {
    if (task.payment !== 'NOT_STARTED' || task.signedData || task.attemptRef) fail('EXECUTION_ALREADY_CLAIMED', 409);
  }
  app.post('/api/tasks/:id/quote', async (req, res) => {
    exact(req.body, []); const owner = (await auth(req)).wallet, id = req.params.id;
    const { task, operation } = await begin(id, owner, 'quote', noExecution);
    try {
      const state = await ready(); await assertSession(req, owner);
      if (!config.merchantPayTo) fail('MERCHANT_NOT_CONFIGURED', 503);
      const quote = validateQuote(await gateway.quote(resourceUrl(task, config)), resourceUrl(task, config), config);
      await assertSession(req, owner);
      const pending = structuredClone(await current(id, owner, operation));
      attachQuote(pending, quote, config, state.payer, now());
      const proposed = await ai.propose(pending.aiSnapshot);
      await assertSession(req, owner); await current(id, owner, operation);
      if (proposed?.status !== 'PROPOSED' || typeof proposed.proposal_ref !== 'string' ||
          !/^[A-Za-z0-9._:/-]{1,160}$/.test(proposed.proposal_ref)) fail(safeCode(proposed?.code, 'PROPOSAL_UNAVAILABLE'), 502);
      const result = await finish(id, owner, operation, t => {
        attachQuote(t, quote, config, state.payer, Date.parse(pending.quote.expiresAt) - config.quoteTtlMs);
        t.proposal = { ref: proposed.proposal_ref, explanation: typeof proposed.explanation === 'string' ? proposed.explanation.slice(0, 512) : '',
          executionKind: typeof proposed.execution_kind === 'string' ? proposed.execution_kind.slice(0, 64) : 'direct_resource' };
        store.event(t, 'QUOTE_READY', 'APPROVAL_REQUIRED');
      });
      await respondTask(req, res, result, owner);
    } catch (error) { await release(id, owner, operation, error); throw error; }
  });
  app.post('/api/tasks/:id/approve', async (req, res) => {
    const owner = (await auth(req)).wallet, state = await ready(); await assertSession(req, owner);
    if (!state.ready || !state.payer) fail('PAYMENT_NOT_READY', 503);
    try {
      const task = await store.mutate(req.params.id, owner, t => { approve(t, req.body, config, state.payer, now()); store.event(t, 'APPROVED', 'APPROVED'); });
      await respondTask(req, res, task, owner);
    } catch (error) {
      if (error instanceof ServiceError && ['BUDGET_DENIED', 'UNAUTHORIZED_PAYMENT_TERMS'].includes(error.code)) {
        await store.mutate(req.params.id, owner, t => { if (t.payment === 'NOT_STARTED' && !t.operation) {
          t.policy = 'DENY'; t.reasonCode = error.code; t.nextAction = 'APPROVE'; store.event(t, 'POLICY_DENIED', error.code);
        } });
      }
      throw error;
    }
  });
  app.post('/api/tasks/:id/revoke', async (req, res) => {
    exact(req.body, []); const owner = (await auth(req)).wallet;
    const task = await store.mutate(req.params.id, owner, t => {
      if (t.approval) t.approval.revoked = true;
      t.policy = 'DENY'; t.reasonCode = 'APPROVAL_REVOKED'; t.nextAction = 'REVIEW';
      store.event(t, 'APPROVAL_REVOKED', t.reasonCode);
    });
    await respondTask(req, res, task, owner);
  });
  async function applyOutcome(req, id, owner, operation, outcome) {
    let task = await current(id, owner, operation);
    const confirmed = outcome?.payment === 'CONFIRMED' && signature(outcome.transaction);
    task = await store.mutate(id, owner, t => {
      if (t.operation?.id !== operation.id) fail('TASK_CHANGED', 409);
      if (confirmed) { t.payment = 'CONFIRMED'; t.transaction = outcome.transaction; }
      else if (t.payment !== 'CONFIRMED') t.payment = outcome?.payment === 'FAILED' ? 'FAILED' : 'UNKNOWN';
      const delivered = t.payment === 'CONFIRMED' && outcome?.delivery === 'COMPLETED' &&
        typeof outcome.body === 'string' && Buffer.byteLength(outcome.body) <= 256_000;
      if (delivered) { t.delivery = 'COMPLETED'; t.deliveredBody = outcome.body; }
      else if (t.delivery !== 'COMPLETED') t.delivery = outcome?.delivery === 'FAILED' || t.payment === 'CONFIRMED' ? 'FAILED' : 'PENDING';
      t.reasonCode = safeCode(outcome?.reasonCode, delivered ? 'RESOURCE_DELIVERED' : 'PAYMENT_RECONCILIATION_REQUIRED');
      t.nextAction = t.payment === 'CONFIRMED' ? (delivered ? 'READ_RESULT' : 'RECOVER') : 'RECONCILE';
      store.event(t, 'PAYMENT_OBSERVED', t.reasonCode);
    });
    // Chain/delivery observations remain durable even if the initiating session
    // ended while the gateway was awaited. Do not release data to a model or
    // publish its result without a fresh live session check.
    await assertSession(req, owner);
    if (task.payment === 'CONFIRMED' && task.delivery === 'COMPLETED' && !task.result) {
      const approvalId = task.approval?.id, quoteHash = task.quote?.hash;
      if (!task.approval?.revoked) {
        const analysis = await ai.consume({ ...task.aiSnapshot, proposalRef: task.proposal.ref,
          attemptRef: task.attemptRef, settlementRef: task.transaction,
          deliveryRef: 'delivery_' + task.id, body: task.deliveredBody,
          policy: 'ALLOW', payment: 'CONFIRMED', fulfillment: 'COMPLETED' });
        await assertSession(req, owner);
        task = await store.mutate(id, owner, t => {
          if (t.operation?.id !== operation.id || t.approval?.id !== approvalId || t.quote?.hash !== quoteHash || t.approval?.revoked) {
            fail('TASK_CHANGED', 409);
          }
          if (analysis?.status === 'EVIDENCE_READY' && analysis.answer && typeof analysis.answer === 'object') {
            t.result = { status: analysis.status, code: safeCode(analysis.code), answer: analysis.answer,
              html: typeof analysis.html === 'string' ? analysis.html : '',
              markdown: typeof analysis.markdown === 'string' ? analysis.markdown : '' };
            t.reasonCode = 'REPORT_READY'; t.nextAction = 'READ_RESULT'; store.event(t, 'REPORT_READY', 'REPORT_READY');
          } else { t.reasonCode = safeCode(analysis?.code, 'REPORT_INVALID'); t.nextAction = 'RECOVER'; store.event(t, 'REPORT_REJECTED', t.reasonCode); }
        });
      }
    }
    return finish(id, owner, operation, () => {});
  }
  app.post('/api/tasks/:id/execute', async (req, res) => {
    exact(req.body, ['approvalId']); const owner = (await auth(req)).wallet, id = req.params.id;
    const state = await ready(); await assertSession(req, owner);
    if (!state.ready || !state.payer) fail('PAYMENT_NOT_READY', 503);
    const { task, operation } = await begin(id, owner, 'execute', t => {
      noExecution(t); assertApproval(t, config, state.payer, now());
      if (req.body.approvalId !== t.approval.id) fail('APPROVAL_REQUIRED', 403);
    });
    try {
      const fresh = validateQuote(await gateway.quote(resourceUrl(task, config)), resourceUrl(task, config), config);
      await assertSession(req, owner);
      if (termsHash(fresh) !== termsHash(task.quoteData)) fail('PAYMENT_TERMS_CHANGED', 409);
      await store.mutate(id, owner, t => {
        if (t.operation?.id !== operation.id) fail('TASK_CHANGED', 409);
        noExecution(t); assertApproval(t, config, state.payer, now());
        t.payment = 'SIGNING'; t.attemptRef = randomUUID(); store.event(t, 'EXECUTION_CLAIMED', 'SIGNING');
      });
      const signed = await gateway.sign(task.quoteData, { beforeSign: async () => {
        await assertSession(req, owner); const t = await current(id, owner, operation);
        if (t.payment !== 'SIGNING' || t.signedData) fail('EXECUTION_ALREADY_CLAIMED', 409);
        assertApproval(t, config, state.payer, now());
      } });
      // Persist the original proof before any merchant request. No replacement
      // proof may be created even if the process exits immediately afterwards.
      await store.mutate(id, owner, t => {
        if (t.operation?.id !== operation.id || t.payment !== 'SIGNING') fail('TASK_CHANGED', 409);
        if (!signed || typeof signed.paymentHeader !== 'string' || signed.payer !== state.payer) fail('INVALID_SIGNED_PAYMENT', 502);
        t.signedData = signed; t.payment = 'PENDING'; t.delivery = 'PENDING'; store.event(t, 'PAYMENT_PREPARED', 'PENDING');
      });
      await assertSession(req, owner);
      assertApproval(await current(id, owner, operation), config, state.payer, now());
      const outcome = await gateway.redeem(resourceUrl(task, config), signed, task.quoteData);
      const result = await applyOutcome(req, id, owner, operation, outcome);
      await respondTask(req, res, result, owner);
    } catch (error) { await release(id, owner, operation, error); throw error; }
  });
  app.post('/api/tasks/:id/reconcile', async (req, res) => {
    exact(req.body, []); const owner = (await auth(req)).wallet, id = req.params.id;
    const { task, operation } = await begin(id, owner, 'reconcile', t => {
      if (!t.attemptRef || t.payment === 'NOT_STARTED') fail('PAYMENT_NOT_STARTED', 409);
    });
    try {
      if (!task.signedData) fail('MANUAL_RECONCILIATION_REQUIRED', 409);
      const outcome = await gateway.reconcile(task.transaction, task.signedData, task.quoteData);
      const result = await finish(id, owner, operation, t => {
        if (outcome?.payment === 'CONFIRMED' && signature(outcome.transaction)) {
          t.payment = 'CONFIRMED'; t.transaction = outcome.transaction;
          t.reasonCode = 'PAYMENT_CONFIRMED'; t.nextAction = t.delivery === 'COMPLETED' ? 'READ_RESULT' : 'RECOVER';
        } else if (t.payment !== 'CONFIRMED') {
          t.payment = outcome?.payment === 'FAILED' ? 'FAILED' : 'UNKNOWN';
          t.reasonCode = safeCode(outcome?.reasonCode, 'PAYMENT_RECONCILIATION_REQUIRED'); t.nextAction = 'RECONCILE';
        }
        store.event(t, 'PAYMENT_RECONCILED', t.reasonCode);
      }); await respondTask(req, res, result, owner);
    } catch (error) { await release(id, owner, operation, error); throw error; }
  });
  app.post('/api/tasks/:id/recover', async (req, res) => {
    exact(req.body, []); const owner = (await auth(req)).wallet, id = req.params.id;
    const { task, operation } = await begin(id, owner, 'recover', t => {
      if (t.payment !== 'CONFIRMED' || !t.signedData) fail('CONFIRM_PAYMENT_FIRST', 409);
      if (t.approval?.revoked) fail('APPROVAL_REVOKED', 403);
    });
    try {
      // A known confirmed transaction is recovered with the original proof;
      // neither the signer nor a fresh payment creation path is reachable.
      const outcome = await gateway.redeem(resourceUrl(task, config), task.signedData, task.quoteData);
      const result = await applyOutcome(req, id, owner, operation, outcome);
      await respondTask(req, res, result, owner);
    } catch (error) { await release(id, owner, operation, error); throw error; }
  });
  if (mountMerchant) app.locals.merchant = mountMerchant(app, { config, reportProvider, receiptStore: store.receipts });
  app.use(express.static(fileURLToPath(new URL('./web/', import.meta.url)), { index: 'index.html', etag: false, dotfiles: 'deny' }));
  app.use((req, res) => res.status(404).json({ error: { code: 'NOT_FOUND' } }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const code = error instanceof ServiceError ? error.code :
      error?.type === 'entity.too.large' ? 'REQUEST_TOO_LARGE' : error?.type === 'entity.parse.failed' ? 'INVALID_JSON' : 'INTEGRATION_UNAVAILABLE';
    const status = error instanceof ServiceError ? error.status : error?.type === 'entity.too.large' ? 413 : error?.type === 'entity.parse.failed' ? 400 : 503;
    res.status(status).json({ error: { code: safeCode(code) } });
  });
  return app;
}
