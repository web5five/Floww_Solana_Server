import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, openSync, closeSync, lstatSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ServiceError, fail } from './config.mjs';

export const digest = value => createHash('sha256').update(value).digest('hex');
export const randomToken = () => randomBytes(32).toString('base64url');
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
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE;
      CREATE TABLE IF NOT EXISTS challenges(id TEXT PRIMARY KEY, wallet TEXT NOT NULL, message TEXT NOT NULL, expires INTEGER NOT NULL, created INTEGER NOT NULL, consumed INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, wallet TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, owner TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS merchant_receipts(key TEXT PRIMARY KEY, state TEXT NOT NULL, data TEXT);
      CREATE INDEX IF NOT EXISTS challenge_wallet_created ON challenges(wallet,created);
      CREATE INDEX IF NOT EXISTS task_owner ON tasks(owner);`);
    // A process restart must never permit an uncertain execution to sign again.
    for (const row of this.db.prepare('SELECT id,owner,data FROM tasks').all()) {
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
  add(task) {
    const count = this.db.prepare('SELECT count(*) AS n FROM tasks WHERE owner=?').get(task.owner).n;
    if (count >= 100) fail('TASK_LIMIT_REACHED', 429);
    task.revision = 1;
    this.db.prepare('INSERT INTO tasks(id,owner,revision,data) VALUES(?,?,?,?)').run(task.id, task.owner, task.revision, JSON.stringify(task));
    return task;
  }
  get(id, owner) {
    const row = this.db.prepare('SELECT data FROM tasks WHERE id=? AND owner=?').get(id, owner);
    if (!row) fail('TASK_NOT_FOUND', 404);
    return JSON.parse(row.data);
  }
  list(owner) { return this.db.prepare('SELECT data FROM tasks WHERE owner=? ORDER BY rowid DESC LIMIT 100').all(owner).map(x => JSON.parse(x.data)); }
  mutate(id, owner, fn) {
    return this.transaction(() => {
      const t = this.get(id, owner); fn(t); t.revision++;
      this.db.prepare('UPDATE tasks SET revision=?,data=? WHERE id=? AND owner=?').run(t.revision, JSON.stringify(t), id, owner);
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
