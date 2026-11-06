import { createHash, randomUUID } from 'node:crypto';
import { atomic, DEVNET, exact, fail, isAddress, iso, ServiceError } from './config.mjs';
import { assertApproval, canonical, resourceUrl, signature, termsHash, validateQuote } from './policy.mjs';

const RESOURCE = 'wallet-transfers';
const DAY = 86_400_000;
const MAX_MANDATES = 100;
const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
const clone = value => structuredClone(value);
const parse = value => typeof value === 'string' ? JSON.parse(value) : clone(value);
const fixed = error => error instanceof ServiceError ? error : new ServiceError('BUDGET_STATE_UNAVAILABLE', 503);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const utcDay = now => new Date(now).toISOString().slice(0, 10);
const json = value => JSON.stringify(value);

function timestamp(value) {
  const result = iso(value);
  if (value.slice(0, 19) !== result.slice(0, 19)) fail('INVALID_TIME');
  return result;
}
function ownerScope(owner) {
  if (!isAddress(owner)) fail('AUTHENTICATION_REQUIRED', 401);
}
function positive(value, code = 'INVALID_BUDGET') {
  try { const amount = atomic(value); if (amount > 0n) return amount; } catch {}
  fail(code, code === 'INVALID_BUDGET_CONFIGURATION' ? 500 : 400);
}
function totals() {
  return { spentAtomic: '0', heldAtomic: '0', executionsSpent: 0, executionsHeld: 0 };
}
function counter(value) {
  if (!value || !Number.isSafeInteger(value.executionsSpent) || value.executionsSpent < 0 ||
      !Number.isSafeInteger(value.executionsHeld) || value.executionsHeld < 0 ||
      atomic(value.spentAtomic) < 0n || atomic(value.heldAtomic) < 0n) fail('BUDGET_STATE_UNAVAILABLE', 503);
  return value;
}
function hold(value, amount) {
  counter(value);
  value.heldAtomic = String(atomic(value.heldAtomic) + amount);
  value.executionsHeld++;
}
function spend(value, amount) {
  counter(value);
  if (atomic(value.heldAtomic) < amount || value.executionsHeld < 1) fail('BUDGET_STATE_UNAVAILABLE', 503);
  value.heldAtomic = String(atomic(value.heldAtomic) - amount);
  value.spentAtomic = String(atomic(value.spentAtomic) + amount);
  value.executionsHeld--;
  value.executionsSpent++;
}
function mandateView(record, now, minimum = 1n) {
  const result = clone(record);
  counter(result);
  result.remainingAtomic = String(atomic(record.budgetAtomic) - atomic(record.spentAtomic) - atomic(record.heldAtomic));
  result.remainingExecutions = record.maxExecutions - record.executionsSpent - record.executionsHeld;
  result.status = record.revokedAt ? 'REVOKED' : Date.parse(record.expiresAt) <= now ? 'EXPIRED'
    : result.remainingExecutions < 1 || atomic(result.remainingAtomic) < minimum ? 'EXHAUSTED' : 'ACTIVE';
  return result;
}
function reservationView(record) {
  return Object.fromEntries(['id', 'taskId', 'mandateId', 'mandateVersion', 'quoteHash', 'payer', 'day',
    'amountAtomic', 'state', 'observedPayment', 'transaction', 'createdAt', 'updatedAt'].map(key => [key, record[key] ?? null]));
}

/**
 * Synchronous SQLite transactions must not yield to another request. A generator
 * describes the same parameterized operations for the synchronous SQLite driver
 * and the asynchronous PostgreSQL driver without awaiting inside SQLite's lock.
 */
function database(store) {
  const postgres = Boolean(store.pool);
  if (!postgres && !store.db) fail('INVALID_BUDGET_STORE', 500);
  const schema = postgres ? 'floww_runtime' : 'main';
  const names = Object.fromEntries(['mandates', 'reservations', 'budget_buckets'].map(name => [name, `${schema}.workspace_${name}`]));
  const sql = (statement, params = []) => ({ statement, params });
  const sqliteQuery = ({ statement, params }) => {
    const values = [];
    const prepared = store.db.prepare(statement.replace(/\$(\d+)/g, (_, index) => { values.push(params[Number(index) - 1]); return '?'; }));
    return /^\s*(?:SELECT|WITH)\b/i.test(statement) ? { rows: prepared.all(...values) }
      : { rows: [], rowCount: Number(prepared.run(...values).changes) };
  };
  const transaction = work => {
    try {
      if (postgres) return store.transaction(async client => {
        const iterator = work(); let step = iterator.next();
        while (!step.done) {
          const result = await client.query(step.value.statement, step.value.params);
          step = iterator.next(result);
        }
        return step.value;
      }).catch(error => { throw fixed(error); });
      return store.transaction(() => {
        const iterator = work(); let step = iterator.next();
        while (!step.done) step = iterator.next(sqliteQuery(step.value));
        return step.value;
      });
    } catch (error) { throw fixed(error); }
  };
  const lock = function* (key) {
    if (postgres) yield sql('SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))', ['floww_runtime.budget:' + key]);
  };
  return { postgres, names, sql, transaction, lock, update: postgres ? ' FOR UPDATE' : '' };
}

export async function createMandateService({ store, config }) {
  if (!store || typeof store.clock !== 'function' || !config || config.network !== DEVNET) fail('INVALID_BUDGET_CONFIGURATION', 500);
  const maximum = positive(config.maxPaymentAtomic, 'INVALID_BUDGET_CONFIGURATION');
  const minimum = positive(config.amountAtomic, 'INVALID_BUDGET_CONFIGURATION');
  if (minimum > maximum) fail('INVALID_BUDGET_CONFIGURATION', 500);
  const configuredDaily = positive(config.dailyPaymentAtomic ?? config.maxPaymentAtomic, 'INVALID_BUDGET_CONFIGURATION');
  const dailyCap = configuredDaily < maximum ? configuredDaily : maximum;
  const db = database(store), { names, sql } = db;
  const clock = () => {
    const now = store.clock();
    if (!Number.isSafeInteger(now) || now < 0) fail('INVALID_CLOCK', 500);
    return now;
  };
  const configured = () => isAddress(config.merchantPayTo) && isAddress(config.asset) &&
    Number.isInteger(config.assetDecimals) && config.assetDecimals >= 0 && config.assetDecimals <= 18 &&
    positive(config.amountAtomic, 'INVALID_BUDGET_CONFIGURATION') <= maximum;
  const requireConfigured = () => { if (!configured()) fail('MERCHANT_NOT_CONFIGURED', 503); };
  const view = (record, now) => mandateView(record, now, minimum);
  const index = (name, table, columns) => sql(`CREATE INDEX IF NOT EXISTS ${name} ON ${db.postgres ? names[table] : 'workspace_' + table}(${columns})`);

  await db.transaction(function* () {
    yield* db.lock('schema.v1');
    // The PostgreSQL schema is pre-provisioned by the existing store. This module
    // never creates a schema, grants permissions, or falls back to public.
    yield sql(`CREATE TABLE IF NOT EXISTS ${names.mandates} (
      id TEXT PRIMARY KEY, owner TEXT NOT NULL, version BIGINT NOT NULL CHECK(version>0),
      created BIGINT NOT NULL, updated BIGINT NOT NULL, expires BIGINT NOT NULL,
      revoked INTEGER NOT NULL CHECK(revoked IN (0,1)), data TEXT NOT NULL)`);
    yield sql(`CREATE TABLE IF NOT EXISTS ${names.reservations} (
      id TEXT PRIMARY KEY, owner TEXT NOT NULL, task_id TEXT NOT NULL UNIQUE,
      mandate_id TEXT, payer TEXT NOT NULL, day TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('HELD','SPENT')),
      created BIGINT NOT NULL, updated BIGINT NOT NULL, data TEXT NOT NULL,
      UNIQUE(owner,task_id))`);
    yield sql(`CREATE TABLE IF NOT EXISTS ${names.budget_buckets} (
      payer TEXT NOT NULL, day TEXT NOT NULL, owner TEXT NOT NULL, data TEXT NOT NULL,
      PRIMARY KEY(payer,day,owner))`);
    yield index('workspace_mandate_owner_created', 'mandates', 'owner,created DESC,id DESC');
    yield index('workspace_mandate_owner_active', 'mandates', 'owner,revoked,expires');
    yield index('workspace_reservation_owner_created', 'reservations', 'owner,created DESC,id DESC');
    yield index('workspace_bucket_owner_day', 'budget_buckets', 'owner,day');
  });

  function* mandate(owner, id) {
    if (!uuid(id)) fail('MANDATE_NOT_FOUND', 404);
    const result = yield sql(`SELECT data FROM ${names.mandates} WHERE id=$1 AND owner=$2${db.update}`, [id, owner]);
    if (!result.rows.length) fail('MANDATE_NOT_FOUND', 404);
    const record = parse(result.rows[0].data);
    if (record.id !== id || record.owner !== owner) fail('BUDGET_STATE_UNAVAILABLE', 503);
    counter(record);
    return record;
  }
  function* saveMandate(record, now) {
    record.updatedAt = new Date(now).toISOString();
    yield sql(`UPDATE ${names.mandates} SET version=$1,updated=$2,revoked=$3,data=$4 WHERE id=$5 AND owner=$6`,
      [record.version, now, record.revokedAt ? 1 : 0, json(record), record.id, record.owner]);
  }
  function* bucket(payer, day, owner) {
    const result = yield sql(`SELECT data FROM ${names.budget_buckets} WHERE payer=$1 AND day=$2 AND owner=$3${db.update}`, [payer, day, owner]);
    return result.rows.length ? counter(parse(result.rows[0].data)) : totals();
  }
  function* saveBucket(payer, day, owner, record) {
    yield sql(`INSERT INTO ${names.budget_buckets}(payer,day,owner,data) VALUES($1,$2,$3,$4)
      ON CONFLICT(payer,day,owner) DO UPDATE SET data=excluded.data`, [payer, day, owner, json(record)]);
  }
  function* reservation(owner, taskId) {
    const result = yield sql(`SELECT data FROM ${names.reservations} WHERE task_id=$1 AND owner=$2${db.update}`, [taskId, owner]);
    if (!result.rows.length) return null;
    const record = parse(result.rows[0].data);
    if (record.owner !== owner || record.taskId !== taskId || !['HELD', 'SPENT'].includes(record.state)) fail('BUDGET_STATE_UNAVAILABLE', 503);
    positive(record.amountAtomic);
    return record;
  }
  function* currentTask(owner, input, compare = true) {
    if (!uuid(input?.id) || input.owner !== owner) fail('TASK_NOT_FOUND', 404);
    const result = yield sql(`SELECT data FROM ${db.postgres ? 'floww_runtime' : 'main'}.tasks WHERE id=$1 AND owner=$2${db.update}`, [input.id, owner]);
    if (!result.rows.length) fail('TASK_NOT_FOUND', 404);
    const task = parse(result.rows[0].data);
    if (task.owner !== owner || task.id !== input.id) fail('TASK_NOT_FOUND', 404);
    // A caller's stale copy cannot change the scope used by the durable ledger.
    if (compare && binding(task) !== binding(input)) fail('RESERVATION_TERMS_CHANGED', 409);
    return task;
  }
  function* assertImported() {
    const field = key => db.postgres ? `(t.data->>'${key}')` : `json_extract(t.data,'$.${key}')`;
    const result = yield sql(`SELECT 1 AS present FROM ${db.postgres ? 'floww_runtime' : 'main'}.tasks t
      WHERE NOT EXISTS (SELECT 1 FROM ${names.reservations} r WHERE r.task_id=t.id AND r.owner=t.owner)
      AND (${field('payment')} IN ('SIGNING','PENDING','UNKNOWN','CONFIRMED')
        OR ${field('attemptRef')} IS NOT NULL OR ${field('signedData')} IS NOT NULL
        OR ${field('transaction')} IS NOT NULL) LIMIT 1`);
    if (result.rows.length) fail('LEDGER_IMPORT_REQUIRED', 503);
  }
  function binding(task) {
    const q = task?.quote, a = task?.approval;
    if (!q || !a || !hex(q.hash) || !uuid(a.id) || !task.quoteData) fail('APPROVAL_REQUIRED', 403);
    return hash({ taskId: task.id, owner: task.owner, purpose: task.purpose, wallet: task.wallet,
      windowStart: task.windowStart, windowEnd: task.windowEnd, workspaceContext: task.workspaceContext ?? null,
      quote: q, terms: termsHash(task.quoteData), approval: { id: a.id, quoteHash: a.quoteHash,
        payer: a.payer, budgetAtomic: a.budgetAtomic, expiresAt: a.expiresAt, approvedAt: a.approvedAt } });
  }
  function checkTask(task, now, { authority = true } = {}) {
    requireConfigured();
    const q = task.quote;
    validateQuote(task.quoteData, resourceUrl(task, config), config);
    const requirements = task.quoteData.requirements;
    if (!q || !hex(q.hash) || !isAddress(q.payer) || q.amountAtomic !== requirements.amount ||
        q.asset !== config.asset || q.assetDecimals !== config.assetDecimals || q.network !== DEVNET ||
        q.recipient !== config.merchantPayTo || q.resourceUrl !== task.quoteData.resourceUrl ||
        !isAddress(task.wallet)) fail('UNAPPROVED_PAYMENT_TERMS', 409);
    const start = Date.parse(timestamp(task.windowStart)), end = Date.parse(timestamp(task.windowEnd));
    if (!(start < end && end <= now && end - start <= 7 * DAY)) fail('INVALID_ANALYTICS_SCOPE');
    const context = task.workspaceContext;
    if (context != null && (typeof context !== 'object' || Array.isArray(context) || context.resourceId !== RESOURCE ||
        ((context.mandateId == null) !== (context.mandateVersion == null)) ||
        (context.mandateId != null && (!uuid(context.mandateId) || !Number.isSafeInteger(context.mandateVersion) || context.mandateVersion < 1)))) {
      fail('INVALID_MANDATE_CONTEXT', 403);
    }
    if (authority) {
      timestamp(q.expiresAt); timestamp(task.approval?.expiresAt);
      assertApproval(task, config, q.payer, now);
    }
    return positive(requirements.amount);
  }
  function checkMandate(record, task, amount, now, { authority = true } = {}) {
    const context = task.workspaceContext;
    if (record.owner !== task.owner || record.id !== context?.mandateId || record.resourceId !== RESOURCE ||
        record.wallet !== task.wallet || record.purpose !== task.purpose || record.network !== DEVNET ||
        record.asset !== task.quote.asset || record.recipient !== task.quote.recipient ||
        Date.parse(task.windowStart) < Date.parse(record.windowStart) || Date.parse(task.windowEnd) > Date.parse(record.windowEnd) ||
        amount > positive(record.perPurchaseAtomic)) fail('MANDATE_SCOPE_DENIED', 403);
    if (authority && (record.revokedAt || Date.parse(record.expiresAt) <= now ||
        context.mandateVersion !== record.version)) fail('MANDATE_NOT_ACTIVE', 403);
  }
  function* lockedTask(owner, input, { unreservedOkay = false } = {}) {
    // Every ledger transition locks in this order. Revocation takes only the
    // mandate row and therefore cannot create a task/payer/mandate cycle.
    const task = yield* currentTask(owner, input, !unreservedOkay);
    const prior = yield* reservation(owner, task.id);
    if (unreservedOkay && !prior) return { task, prior: null };
    if (unreservedOkay && binding(task) !== binding(input)) fail('RESERVATION_TERMS_CHANGED', 409);
    const payer = prior?.payer ?? task.quote?.payer;
    const day = prior?.day ?? utcDay(clock());
    if (!isAddress(payer)) fail('PAYER_CHANGED', 403);
    yield* db.lock('payer:' + payer + ':' + day);
    let scoped = null;
    const mandateId = prior?.mandateId ?? task.workspaceContext?.mandateId;
    if (mandateId) {
      yield* db.lock('mandate:' + mandateId);
      scoped = yield* mandate(owner, mandateId);
    }
    return { task, prior, payer, day, scoped };
  }
  function assertBinding(prior, task) {
    if (!prior || prior.bindingHash !== binding(task) || prior.quoteHash !== task.quote.hash ||
        prior.payer !== task.quote.payer || prior.amountAtomic !== task.quote.amountAtomic) fail('RESERVATION_TERMS_CHANGED', 409);
  }

  const catalog = () => [{
    id: RESOURCE, name: 'Solana wallet transfer report',
    description: 'A report of observed native SOL and SPL transfers for one wallet and an explicit time window.',
    capability: RESOURCE, capabilities: [RESOURCE], dataNetwork: 'solana-devnet', network: DEVNET,
    maxWindowDays: 7,
    coverage: ['Confirmed wallet transactions within the selected window', 'Native SOL and SPL transfer observations',
      'Bounded history with explicit coverage limits'],
    status: configured() ? 'AVAILABLE' : 'SETUP_REQUIRED',
  }];
  async function readiness() {
    try {
      await db.transaction(function* () { yield* assertImported(); });
      return { ready: true, reasonCode: 'LEDGER_READY' };
    } catch (error) {
      return { ready: false, reasonCode: error?.code === 'LEDGER_IMPORT_REQUIRED'
        ? 'LEDGER_IMPORT_REQUIRED' : 'BUDGET_STATE_UNAVAILABLE' };
    }
  }

  async function create(owner, input) {
    ownerScope(owner); requireConfigured();
    exact(input, ['purpose', 'wallet', 'windowStart', 'windowEnd', 'budgetAtomic', 'perPurchaseAtomic', 'expiresAt', 'maxExecutions', 'acknowledge']);
    if (input.acknowledge !== true) fail('EXPLICIT_APPROVAL_REQUIRED');
    if (typeof input.purpose !== 'string' || !input.purpose.trim() || input.purpose.length > 2_000 ||
        /[\x00-\x08\x0b-\x1f\x7f]/.test(input.purpose) || !isAddress(input.wallet)) fail('INVALID_MANDATE');
    const windowStart = timestamp(input.windowStart), windowEnd = timestamp(input.windowEnd), expiresAt = timestamp(input.expiresAt);
    const start = Date.parse(windowStart), end = Date.parse(windowEnd), expires = Date.parse(expiresAt);
    const budget = positive(input.budgetAtomic), perPurchase = positive(input.perPurchaseAtomic);
    if (!Number.isSafeInteger(input.maxExecutions) || input.maxExecutions < 1 || input.maxExecutions > 100 ||
        perPurchase > maximum || budget < perPurchase || budget > perPurchase * BigInt(input.maxExecutions)) fail('INVALID_BUDGET');
    const now = clock();
    if (!(start < end && end <= now && end - start <= 7 * DAY) || !(now < expires && expires <= now + 30 * DAY)) fail('INVALID_MANDATE_SCOPE');
    const scope = { purpose: input.purpose.trim().normalize('NFC'), wallet: input.wallet, windowStart, windowEnd,
      budgetAtomic: String(budget), perPurchaseAtomic: String(perPurchase), expiresAt,
      maxExecutions: input.maxExecutions, resourceId: RESOURCE, capability: RESOURCE,
      network: DEVNET, asset: config.asset, recipient: config.merchantPayTo };
    const record = { id: randomUUID(), owner, version: 1, ...scope,
      hash: hash({ owner, version: 1, ...scope }), createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(), revokedAt: null, ...totals() };
    return db.transaction(function* () {
      yield* db.lock('owner:' + owner);
      // Limit concurrently usable mandates; expired/revoked records remain as
      // evidence and do not prevent continued use of the workspace.
      const current = clock();
      if (expires <= current) fail('INVALID_MANDATE_SCOPE');
      const existing = yield sql(`SELECT count(*) AS n FROM ${names.mandates} WHERE owner=$1 AND revoked=0 AND expires>$2`, [owner, current]);
      if (Number(existing.rows[0].n) >= MAX_MANDATES) fail('MANDATE_LIMIT_REACHED', 429);
      yield sql(`INSERT INTO ${names.mandates}(id,owner,version,created,updated,expires,revoked,data) VALUES($1,$2,$3,$4,$5,$6,0,$7)`,
        [record.id, owner, record.version, now, now, expires, json(record)]);
      return view(record, current);
    });
  }
  async function get(owner, id) {
    ownerScope(owner);
    return db.transaction(function* () { return view(yield* mandate(owner, id), clock()); });
  }
  async function list(owner) {
    ownerScope(owner);
    return db.transaction(function* () {
      const result = yield sql(`SELECT data FROM ${names.mandates} WHERE owner=$1 ORDER BY created DESC,id DESC LIMIT 100`, [owner]);
      const now = clock();
      return result.rows.map(row => view(parse(row.data), now));
    });
  }
  async function revoke(owner, id, expectedVersion) {
    ownerScope(owner);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) fail('INVALID_MANDATE_VERSION');
    return db.transaction(function* () {
      yield* db.lock('mandate:' + id);
      const record = yield* mandate(owner, id);
      if (record.version !== expectedVersion) fail('MANDATE_VERSION_CHANGED', 409);
      if (!record.revokedAt) {
        const now = clock(); record.version++; record.revokedAt = new Date(now).toISOString();
        record.hash = hash({ previousHash: record.hash, version: record.version, revokedAt: record.revokedAt });
        yield* saveMandate(record, now);
      }
      return view(record, clock());
    });
  }
  async function reserve(owner, input) {
    ownerScope(owner);
    return db.transaction(function* () {
      // Existing purchases must be explicitly accounted for before a new server
      // can claim a strict payer daily cap. Never guess a historical payment day.
      yield* assertImported();
      const { task, prior, payer, day, scoped } = yield* lockedTask(owner, input);
      const now = clock(), amount = checkTask(task, now);
      if (day !== utcDay(now)) fail('RESERVATION_DAY_CHANGED', 409);
      if (task.payment !== 'NOT_STARTED' || task.signedData || task.attemptRef) fail('EXECUTION_ALREADY_CLAIMED', 409);
      if (scoped) checkMandate(scoped, task, amount, now);
      if (prior) {
        assertBinding(prior, task);
        if (prior.state !== 'HELD' || prior.observedPayment !== 'NOT_STARTED') fail('EXECUTION_ALREADY_CLAIMED', 409);
        if (prior.day !== utcDay(now)) fail('RESERVATION_DAY_CHANGED', 409);
        return reservationView(prior);
      }
      const global = yield* bucket(payer, day, '*'), owned = yield* bucket(payer, day, owner);
      if (atomic(global.spentAtomic) + atomic(global.heldAtomic) + amount > dailyCap) fail('DAILY_BUDGET_EXCEEDED', 403);
      if (scoped && (atomic(scoped.spentAtomic) + atomic(scoped.heldAtomic) + amount > positive(scoped.budgetAtomic) ||
          scoped.executionsSpent + scoped.executionsHeld >= scoped.maxExecutions)) fail('MANDATE_BUDGET_EXCEEDED', 403);
      const record = { id: randomUUID(), taskId: task.id, owner, payer, day, amountAtomic: String(amount),
        mandateId: scoped?.id ?? null, mandateVersion: task.workspaceContext?.mandateVersion ?? null,
        quoteHash: task.quote.hash, bindingHash: binding(task), state: 'HELD', observedPayment: 'NOT_STARTED',
        transaction: null, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() };
      hold(global, amount); hold(owned, amount);
      yield* saveBucket(payer, day, '*', global); yield* saveBucket(payer, day, owner, owned);
      if (scoped) { hold(scoped, amount); yield* saveMandate(scoped, now); }
      yield sql(`INSERT INTO ${names.reservations}(id,owner,task_id,mandate_id,payer,day,state,created,updated,data)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [record.id, owner, task.id, record.mandateId, payer, day, record.state, now, now, json(record)]);
      return reservationView(record);
    });
  }
  async function assertReservation(owner, input) {
    ownerScope(owner);
    return db.transaction(function* () {
      yield* assertImported();
      const { task, prior, payer, day, scoped } = yield* lockedTask(owner, input);
      const now = clock(), amount = checkTask(task, now);
      assertBinding(prior, task);
      if (task.payment !== 'SIGNING' || !uuid(task.attemptRef) || task.signedData || prior.state !== 'HELD' ||
          !['NOT_STARTED', 'SIGNING'].includes(prior.observedPayment)) fail('EXECUTION_ALREADY_CLAIMED', 409);
      if (day !== utcDay(now)) fail('RESERVATION_DAY_CHANGED', 409);
      if (scoped) checkMandate(scoped, task, amount, now);
      const global = yield* bucket(payer, day, '*');
      if (atomic(global.spentAtomic) + atomic(global.heldAtomic) > dailyCap) fail('DAILY_BUDGET_EXCEEDED', 403);
      if (scoped && (atomic(scoped.spentAtomic) + atomic(scoped.heldAtomic) > positive(scoped.budgetAtomic) ||
          scoped.executionsSpent + scoped.executionsHeld > scoped.maxExecutions)) fail('MANDATE_BUDGET_EXCEEDED', 403);
      return reservationView(prior);
    });
  }
  async function observe(owner, input) {
    ownerScope(owner);
    return db.transaction(function* () {
      const { task, prior, payer, day, scoped } = yield* lockedTask(owner, input, { unreservedOkay: true });
      if (!prior) return null;
      assertBinding(prior, task);
      const now = clock();
      if (prior.state === 'SPENT') return reservationView(prior);
      if (!['NOT_STARTED', 'SIGNING', 'PENDING', 'UNKNOWN', 'FAILED', 'CONFIRMED'].includes(task.payment)) fail('INVALID_PAYMENT_OBSERVATION', 409);
      if (task.payment === 'CONFIRMED') {
        // Core gateway independently confirms the chain. This ledger consumes
        // only its durable server-owned observation and the original bound proof.
        const signed = task.signedData;
        if (!task.attemptRef || !signature(task.transaction) || !signed || signed.payer !== payer ||
            signed.resourceUrl !== task.quoteData.resourceUrl || !hex(signed.messageHash) ||
            canonical(signed.requirements) !== canonical(task.quoteData.requirements)) fail('INVALID_PAYMENT_OBSERVATION', 409);
        const amount = positive(prior.amountAtomic), global = yield* bucket(payer, day, '*'), owned = yield* bucket(payer, day, owner);
        spend(global, amount); spend(owned, amount);
        yield* saveBucket(payer, day, '*', global); yield* saveBucket(payer, day, owner, owned);
        if (scoped) { spend(scoped, amount); yield* saveMandate(scoped, now); }
        prior.state = 'SPENT'; prior.transaction = task.transaction;
      }
      // No FAILED release: raw HTTP errors, expiry and missing proof never prove
      // a transfer did not settle. A future reviewed release path needs its own
      // conclusive, exact-transfer failure evidence, not this generic state flag.
      if (task.payment !== 'NOT_STARTED' || prior.observedPayment === 'NOT_STARTED') prior.observedPayment = task.payment;
      prior.updatedAt = new Date(now).toISOString();
      yield sql(`UPDATE ${names.reservations} SET state=$1,updated=$2,data=$3 WHERE task_id=$4 AND owner=$5`,
        [prior.state, now, json(prior), task.id, owner]);
      return reservationView(prior);
    });
  }
  async function dashboard(owner) {
    ownerScope(owner);
    return db.transaction(function* () {
      const now = clock(), day = utcDay(now);
      // One owner can have several historical payer buckets after an authorized
      // runtime replacement; combine only that owner's current-day facts.
      const buckets = yield sql(`SELECT data FROM ${names.budget_buckets} WHERE owner=$1 AND day=$2`, [owner, day]);
      const combined = totals();
      let spent = 0n, held = 0n;
      for (const row of buckets.rows) {
        const value = counter(parse(row.data));
        spent += atomic(value.spentAtomic); held += atomic(value.heldAtomic);
        combined.executionsSpent += value.executionsSpent; combined.executionsHeld += value.executionsHeld;
      }
      combined.spentAtomic = String(spent); combined.heldAtomic = String(held);
      const all = yield sql(`SELECT data FROM ${names.mandates} WHERE owner=$1 AND revoked=0 AND expires>$2 LIMIT 100`, [owner, now]);
      const recent = yield sql(`SELECT data FROM ${names.reservations} WHERE owner=$1 ORDER BY created DESC,id DESC LIMIT 50`, [owner]);
      return { day, dailyLimitAtomic: String(dailyCap), ...combined,
        activeMandates: all.rows.map(row => view(parse(row.data), now)).filter(record => record.status === 'ACTIVE').length,
        reservations: recent.rows.map(row => reservationView(parse(row.data))) };
    });
  }
  return Object.freeze({ catalog, readiness, create, list, get, revoke, reserve, assertReservation, observe, dashboard });
}
