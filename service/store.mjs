import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, openSync, closeSync, lstatSync, chmodSync, realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ServiceError, fail } from './config.mjs';

export const digest = value => createHash('sha256').update(value).digest('hex');
export const randomToken = () => randomBytes(32).toString('base64url');
export const immutableContext = task => task.workspaceContext === undefined ? 'ABSENT' : task.workspaceContext === null ? 'NULL'
  : JSON.stringify(Object.entries(task.workspaceContext).sort(([a], [b]) => a.localeCompare(b)));
export function idempotencyOptions({ idempotencyKey, bodyHash } = {}) {
  if (idempotencyKey === undefined) return null;
  if (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(idempotencyKey) ||
      typeof bodyHash !== 'string' || !/^[a-f0-9]{64}$/.test(bodyHash)) fail('INVALID_IDEMPOTENCY_KEY');
  return { key: idempotencyKey, hash: bodyHash };
}
export function pageOptions(owner, { limit = 20, cursor, includeArchived = false } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || typeof includeArchived !== 'boolean') fail('INVALID_PAGE');
  let after = null;
  if (cursor !== undefined) {
    try {
      if (typeof cursor !== 'string' || cursor.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
      const decoded = Buffer.from(cursor, 'base64url');
      if (decoded.toString('base64url') !== cursor) throw new Error();
      after = JSON.parse(decoded.toString('utf8'));
      if (Object.keys(after).sort().join(',') !== 'archived,created,id,owner,v' || after.v !== 1 ||
          after.owner !== digest(owner) || after.archived !== includeArchived ||
          !Number.isSafeInteger(after.created) || after.created < 0 || typeof after.id !== 'string' ||
          !/^[A-Za-z0-9._:/-]{1,160}$/.test(after.id)) throw new Error();
    } catch { fail('INVALID_CURSOR'); }
  }
  return { limit, includeArchived, after };
}
export const nextCursor = (owner, includeArchived, row) => Buffer.from(JSON.stringify({
  v: 1, owner: digest(owner), archived: includeArchived, created: Number(row.created), id: row.id,
})).toString('base64url');
export function taskSummary(task) {
  return { ...Object.fromEntries(['id', 'revision', 'purpose', 'wallet', 'windowStart', 'windowEnd', 'createdAt',
    'archivedAt', 'policy', 'payment', 'delivery', 'reasonCode', 'nextAction', 'workspaceContext']
    .map(key => [key, task[key] ?? null])), resultAvailable: Boolean(task.result?.answer) };
}
export function archiveCheck(task) {
  if (task.operation || ['SIGNING', 'PENDING', 'UNKNOWN'].includes(task.payment) ||
      (task.attemptRef && !['CONFIRMED', 'FAILED'].includes(task.payment)) ||
      (task.payment === 'CONFIRMED' && (task.delivery !== 'COMPLETED' || !task.result?.answer))) fail('TASK_UNRESOLVED', 409);
}
export function taskDashboard(rows) {
  const result = { total: 0, active: 0, archived: 0, resultAvailable: 0, recoveryRequired: 0,
    payment: Object.fromEntries(['NOT_STARTED', 'SIGNING', 'PENDING', 'UNKNOWN', 'CONFIRMED', 'FAILED'].map(key => [key, 0])),
    delivery: Object.fromEntries(['NOT_STARTED', 'PENDING', 'COMPLETED', 'FAILED'].map(key => [key, 0])) };
  for (const row of rows) {
    const n = Number(row.n), available = row.result_available === true || row.result_available === 1;
    result.total += n; result[row.archived ? 'archived' : 'active'] += n;
    if (Object.hasOwn(result.payment, row.payment)) result.payment[row.payment] += n;
    if (Object.hasOwn(result.delivery, row.delivery)) result.delivery[row.delivery] += n;
    if (available) result.resultAvailable += n;
    if (['SIGNING', 'PENDING', 'UNKNOWN'].includes(row.payment) ||
        (row.payment === 'CONFIRMED' && (row.delivery !== 'COMPLETED' || !available))) result.recoveryRequired += n;
  }
  return result;
}
export class Store {
  constructor(path, { clock = () => Date.now() } = {}) {
    this.clock = clock;
    if (path !== ':memory:') {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      try { const fd = openSync(path, 'wx', 0o600); closeSync(fd); }
      catch (error) { if (error.code !== 'EEXIST') throw new ServiceError('STATE_UNAVAILABLE', 500); }
      const st = lstatSync(path);
      if (!st.isFile() || st.isSymbolicLink() || (process.getuid && st.uid !== process.getuid())) fail('UNSAFE_STATE_FILE', 500);
      chmodSync(path, 0o600);
    }
    this.db = new DatabaseSync(path);
    // An operator reader may open only this exact owned file, independently and
    // read-only. Never infer it from configuration when a Store was injected.
    const stateFile = path === ':memory:' ? null : realpathSync(path);
    const stateStat = stateFile === null ? null : lstatSync(stateFile);
    Object.defineProperty(this, 'adminReadSource', { value: Object.freeze({ kind: 'sqlite',
      path: stateFile, device: stateStat?.dev ?? null, inode: stateStat?.ino ?? null }), enumerable: false });
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE;
      CREATE TABLE IF NOT EXISTS challenges(id TEXT PRIMARY KEY, wallet TEXT NOT NULL, message TEXT NOT NULL, expires INTEGER NOT NULL, created INTEGER NOT NULL, consumed INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, wallet TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, owner TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS merchant_receipts(key TEXT PRIMARY KEY, state TEXT NOT NULL, data TEXT);
      CREATE INDEX IF NOT EXISTS challenge_wallet_created ON challenges(wallet,created);
      CREATE INDEX IF NOT EXISTS task_owner ON tasks(owner);
      CREATE TABLE IF NOT EXISTS task_idempotency(owner TEXT NOT NULL, request_key TEXT NOT NULL, body_hash TEXT NOT NULL,
        task_id TEXT NOT NULL REFERENCES tasks(id), PRIMARY KEY(owner,request_key));`);
    this.transaction(() => {
      const columns = this.db.prepare('PRAGMA table_info(tasks)').all().map(row => row.name);
      if (!columns.includes('created')) this.db.exec('ALTER TABLE tasks ADD COLUMN created INTEGER NOT NULL DEFAULT 0');
      if (!columns.includes('archived')) this.db.exec('ALTER TABLE tasks ADD COLUMN archived INTEGER NOT NULL DEFAULT 0');
      for (const row of this.db.prepare('SELECT id,data FROM tasks WHERE created=0').all()) {
        const task = JSON.parse(row.data), time = Date.parse(task.createdAt);
        this.db.prepare('UPDATE tasks SET created=?,archived=? WHERE id=?').run(
          Number.isFinite(time) && time > 0 ? time : this.clock(), task.archivedAt ? 1 : 0, row.id);
      }
      this.db.exec('CREATE INDEX IF NOT EXISTS task_owner_page ON tasks(owner,archived,created DESC,id DESC)');
    });
    // A process restart must never permit an uncertain execution to sign again.
    for (const row of this.db.prepare(`SELECT id,owner,data FROM tasks WHERE
      (json_type(data,'$.operation') IS NOT NULL AND json_type(data,'$.operation')<>'null') OR
      json_extract(data,'$.payment') IN ('SIGNING','PENDING')`).all()) {
      const task = JSON.parse(row.data);
      if (task.operation || ['SIGNING', 'PENDING'].includes(task.payment)) {
        this.mutate(task.id, task.owner, t => {
          t.operation = null;
          if (['SIGNING', 'PENDING'].includes(t.payment)) {
            t.payment = 'UNKNOWN'; t.reasonCode = 'PROCESS_RESTART_RECONCILE';
            t.nextAction = 'RECONCILE'; this.event(t, 'RECOVERY_REQUIRED', t.reasonCode);
          }
        });
      }
    }
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  event(task, type, code) {
    task.events.push({ id: randomUUID(), at: new Date(this.clock()).toISOString(), type, code });
    if (task.events.length > 100) task.events = task.events.slice(-100);
  }
  challenge(wallet, origin) {
    return this.transaction(() => {
      const now = this.clock();
      this.db.prepare('DELETE FROM challenges WHERE expires < ?').run(now - 3600_000);
      const total = this.db.prepare('SELECT count(*) AS n FROM challenges WHERE created > ?').get(now - 60_000).n;
      const count = this.db.prepare('SELECT count(*) AS n FROM challenges WHERE wallet = ? AND created > ?').get(wallet, now - 60_000).n;
      if (count >= 5 || total >= 100) fail('RATE_LIMITED', 429);
      const id = randomUUID(), expires = now + 5 * 60_000;
      const message = `${new URL(origin).host} requests a Floww sign-in.\nWallet: ${wallet}\nURI: ${origin}\nNetwork: Solana Devnet\nNonce: ${randomToken()}\nIssued at: ${new Date(now).toISOString()}\nExpires at: ${new Date(expires).toISOString()}\nThis signature authenticates your session. It does not approve a payment.`;
      this.db.prepare('INSERT INTO challenges(id,wallet,message,expires,created) VALUES(?,?,?,?,?)').run(id, wallet, message, expires, now);
      return { challengeId: id, message, expiresAt: new Date(expires).toISOString() };
    });
  }
  authenticate(id, wallet, checkSignature, ttl) {
    return this.transaction(() => {
      const c = this.db.prepare('SELECT * FROM challenges WHERE id=?').get(id);
      if (!c || c.wallet !== wallet || c.consumed || c.expires <= this.clock()) fail('INVALID_CHALLENGE', 401);
      if (!checkSignature(c.message)) fail('INVALID_SIGNATURE', 401);
      this.db.prepare('UPDATE challenges SET consumed=1 WHERE id=?').run(id);
      this.db.prepare('DELETE FROM sessions WHERE expires <= ?').run(this.clock());
      const token = randomToken(), expires = this.clock() + ttl;
      this.db.prepare('INSERT INTO sessions(hash,wallet,expires) VALUES(?,?,?)').run(digest(token), wallet, expires);
      return { token, wallet, expires };
    });
  }
  session(token) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    return this.db.prepare('SELECT wallet,expires FROM sessions WHERE hash=? AND expires>?').get(digest(token), this.clock()) || null;
  }
  logout(token) { if (token) this.db.prepare('DELETE FROM sessions WHERE hash=?').run(digest(token)); }
  add(task, options) {
    const request = idempotencyOptions(options);
    return this.transaction(() => {
      if (request) {
        const saved = this.db.prepare('SELECT body_hash,task_id FROM task_idempotency WHERE owner=? AND request_key=?').get(task.owner, request.key);
        if (saved) {
          if (saved.body_hash !== request.hash) fail('IDEMPOTENCY_CONFLICT', 409);
          return this.get(saved.task_id, task.owner);
        }
      }
      const count = this.db.prepare('SELECT count(*) AS n FROM tasks WHERE owner=? AND archived=0').get(task.owner).n;
      if (count >= 100) fail('TASK_LIMIT_REACHED', 429);
      task.revision = 1; task.archivedAt = null;
      task.createdAt ??= new Date(this.clock()).toISOString();
      this.db.prepare('INSERT INTO tasks(id,owner,revision,data,created,archived) VALUES(?,?,?,?,?,0)').run(
        task.id, task.owner, task.revision, JSON.stringify(task), Date.parse(task.createdAt));
      if (request) this.db.prepare('INSERT INTO task_idempotency(owner,request_key,body_hash,task_id) VALUES(?,?,?,?)')
        .run(task.owner, request.key, request.hash, task.id);
      return task;
    });
  }
  get(id, owner) {
    const row = this.db.prepare('SELECT data FROM tasks WHERE id=? AND owner=?').get(id, owner);
    if (!row) fail('TASK_NOT_FOUND', 404);
    return JSON.parse(row.data);
  }
  list(owner) { return this.db.prepare('SELECT data FROM tasks WHERE owner=? ORDER BY rowid DESC LIMIT 100').all(owner).map(x => JSON.parse(x.data)); }
  page(owner, options) {
    const { limit, after, includeArchived } = pageOptions(owner, options);
    const args = [owner], clauses = ['owner=?'];
    if (!includeArchived) clauses.push('archived=0');
    if (after) { clauses.push('(created<? OR (created=? AND id<?))'); args.push(after.created, after.created, after.id); }
    const rows = this.db.prepare(`SELECT id,created,json_remove(data,'$.result','$.signedData','$.quoteData','$.aiSnapshot',
      '$.deliveredBody','$.operation','$.events','$.approval','$.proposal','$.quote') AS data,
      (json_type(data,'$.result.answer') IS NOT NULL AND json_type(data,'$.result.answer')<>'null') AS result_available
      FROM tasks WHERE ${clauses.join(' AND ')} ORDER BY created DESC,id DESC LIMIT ?`).all(...args, limit + 1);
    return { tasks: rows.slice(0, limit).map(row => ({ ...taskSummary(JSON.parse(row.data)), resultAvailable: Boolean(row.result_available) })),
      nextCursor: rows.length > limit ? nextCursor(owner, includeArchived, rows[limit - 1]) : null };
  }
  dashboard(owner) {
    return taskDashboard(this.db.prepare(`SELECT archived,json_extract(data,'$.payment') AS payment,
      json_extract(data,'$.delivery') AS delivery,
      (json_type(data,'$.result.answer') IS NOT NULL AND json_type(data,'$.result.answer')<>'null') AS result_available,
      count(*) AS n FROM tasks WHERE owner=? GROUP BY archived,payment,delivery,result_available`).all(owner));
  }
  archive(id, owner) { return this.mutate(id, owner, task => { archiveCheck(task); task.archivedAt ??= new Date(this.clock()).toISOString(); }); }
  restore(id, owner) {
    return this.transaction(() => {
      const task = this.get(id, owner);
      if (task.archivedAt && this.db.prepare('SELECT count(*) AS n FROM tasks WHERE owner=? AND archived=0').get(owner).n >= 100) fail('TASK_LIMIT_REACHED', 429);
      task.archivedAt = null; task.revision++;
      this.db.prepare('UPDATE tasks SET revision=?,data=?,archived=0 WHERE id=? AND owner=?').run(task.revision, JSON.stringify(task), id, owner);
      return task;
    });
  }
  mutate(id, owner, fn) {
    return this.transaction(() => {
      const t = this.get(id, owner), context = immutableContext(t), result = fn(t);
      if (result && typeof result.then === 'function') { Promise.resolve(result).catch(() => {}); fail('ASYNC_MUTATION_NOT_ALLOWED', 500); }
      if (t.id !== id || t.owner !== owner || immutableContext(t) !== context) fail('TASK_IDENTITY_CHANGED', 500);
      t.revision++;
      this.db.prepare('UPDATE tasks SET revision=?,data=?,archived=? WHERE id=? AND owner=?').run(t.revision, JSON.stringify(t), t.archivedAt ? 1 : 0, id, owner);
      return t;
    });
  }
  receipts = {
    get: key => { const row = this.db.prepare('SELECT data,state FROM merchant_receipts WHERE key=?').get(key); return row?.data ? JSON.parse(row.data) : null; },
    put: (key, data) => this.db.prepare("INSERT INTO merchant_receipts(key,state,data) VALUES(?,'COMPLETED',?) ON CONFLICT(key) DO UPDATE SET state='COMPLETED',data=excluded.data").run(key, JSON.stringify(data)),
    claim: key => Boolean(this.db.prepare("INSERT OR IGNORE INTO merchant_receipts(key,state) VALUES(?,'PENDING')").run(key).changes),
  };
  close() { this.db.close(); }
}
