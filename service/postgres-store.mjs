import pg from 'pg';
import { createHash, randomBytes, randomUUID, X509Certificate } from 'node:crypto';
import { ServiceError, fail } from './config.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('base64url');
const thenable = value => value && typeof value.then === 'function';
const fixed = error => error instanceof ServiceError ? error : new ServiceError('STATE_UNAVAILABLE', 503);
const rejectAsync = value => {
  if (thenable(value)) {
    Promise.resolve(value).catch(() => {});
    fail('ASYNC_MUTATION_NOT_ALLOWED', 500);
  }
};

function certificateAuthority(caPem) {
  if (caPem === undefined || caPem === null || caPem === '') return undefined;
  try {
    if (typeof caPem !== 'string' || Buffer.byteLength(caPem, 'utf8') > 65_536) throw new Error();
    // Accept one certificate only, never file paths, private keys, or a PEM bundle.
    const match = /^-----BEGIN CERTIFICATE-----\r?\n([A-Za-z0-9+/=\r\n]+)\r?\n-----END CERTIFICATE-----$/.exec(caPem.trim());
    if (!match) throw new Error();
    const encoded = match[1].replace(/[\r\n]/g, ''), der = Buffer.from(encoded, 'base64');
    if (der.toString('base64') !== encoded) throw new Error();
    const certificate = new X509Certificate(der), now = Date.now();
    if (!certificate.raw.equals(der) || !certificate.ca
        || !(Date.parse(certificate.validFrom) <= now && now < Date.parse(certificate.validTo))) throw new Error();
    return certificate.toString();
  } catch { fail('INVALID_DATABASE_CA', 500); }
}

function poolConfig(databaseUrl, caPem) {
  const ca = certificateAuthority(caPem);
  try {
    const url = new URL(databaseUrl);
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username
        || !url.pathname.slice(1) || url.pathname.slice(1).includes('/') || url.hash
        || (url.port && (!/^\d+$/.test(url.port) || Number(url.port) < 1 || Number(url.port) > 65_535))) {
      fail('INVALID_DATABASE_CONFIGURATION', 500);
    }
    if ((!local || ca) && url.searchParams.has('sslmode')
        && !['require', 'verify-ca', 'verify-full'].includes(url.searchParams.get('sslmode'))) {
      fail('DATABASE_TLS_REQUIRED', 500);
    }
    // Parse fields explicitly. pg's connectionString SSL parameters can override
    // an ssl object; no URL parameter may disable certificate verification here.
    return { host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port || 5432),
      database: decodeURIComponent(url.pathname.slice(1)), user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      ssl: ca ? { rejectUnauthorized: true, ca } : local ? false : { rejectUnauthorized: true },
      max: 5, connectionTimeoutMillis: 8_000, idleTimeoutMillis: 10_000,
      query_timeout: 15_000, statement_timeout: 10_000, application_name: 'floww-runtime' };
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    fail('INVALID_DATABASE_CONFIGURATION', 500);
  }
}

/** Isolated-schema durable state; never mutates the legacy/team public schema. */
export class PostgresStore {
  static async open(databaseUrl, { clock = Date.now, caPem, pool, poolFactory = config => new pg.Pool(config) } = {}) {
    const config = poolConfig(databaseUrl, caPem);
    if (typeof clock !== 'function' || typeof poolFactory !== 'function') fail('INVALID_DATABASE_CONFIGURATION', 500);
    const ownsPool = !pool;
    let selected;
    try { selected = pool ?? poolFactory(config); } catch { fail('STATE_UNAVAILABLE', 503); }
    if (typeof selected.connect !== 'function' || typeof selected.query !== 'function') {
      fail('INVALID_DATABASE_CONFIGURATION', 500);
    }
    if (ownsPool) selected.on?.('error', () => {});
    const store = new PostgresStore(selected, clock, ownsPool);
    try {
      await store.transaction(async client => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended('floww_runtime.schema.v1', 0))");
        // CREATE SCHEMA IF NOT EXISTS still requires database CREATE permission.
        // A managed database may pre-provision this schema for a limited login.
        const schema = await client.query('SELECT oid FROM pg_catalog.pg_namespace WHERE nspname=$1', ['floww_runtime']);
        if (schema.rows.length === 0) await client.query('CREATE SCHEMA floww_runtime');
        await client.query(`CREATE TABLE IF NOT EXISTS floww_runtime.challenges (
            id TEXT PRIMARY KEY, wallet TEXT NOT NULL, message TEXT NOT NULL,
            expires BIGINT NOT NULL, created BIGINT NOT NULL, consumed BOOLEAN NOT NULL DEFAULT FALSE);
          CREATE TABLE IF NOT EXISTS floww_runtime.sessions (
            hash TEXT PRIMARY KEY, wallet TEXT NOT NULL, expires BIGINT NOT NULL);
          CREATE TABLE IF NOT EXISTS floww_runtime.tasks (
            id TEXT PRIMARY KEY, owner TEXT NOT NULL, revision BIGINT NOT NULL CHECK(revision>0),
            data JSONB NOT NULL, created BIGINT NOT NULL);
          CREATE TABLE IF NOT EXISTS floww_runtime.merchant_receipts (
            key TEXT PRIMARY KEY, state TEXT NOT NULL CHECK(state IN ('PENDING','COMPLETED')), data JSONB);
          CREATE INDEX IF NOT EXISTS challenge_wallet_created ON floww_runtime.challenges(wallet,created);
          CREATE INDEX IF NOT EXISTS task_owner_created ON floww_runtime.tasks(owner,created DESC);`);
      });
      return store;
    } catch (error) {
      if (ownsPool) { try { await selected.end(); } catch {} }
      throw fixed(error);
    }
  }

  constructor(pool, clock, ownsPool = false) {
    this.pool = pool; this.clock = clock; this.ownsPool = ownsPool;
  }

  async transaction(fn) {
    let client, begun = false, releaseError;
    try {
      client = await this.pool.connect();
      await client.query('BEGIN'); begun = true;
      const result = await fn(client);
      await client.query('COMMIT'); begun = false;
      return result;
    } catch (error) {
      if (client && begun) {
        try { await client.query('ROLLBACK'); } catch { releaseError = new Error('STATE_UNAVAILABLE'); }
      }
      throw fixed(error);
    } finally {
      try { client?.release(releaseError); } catch { fail('STATE_UNAVAILABLE', 503); }
    }
  }

  event(task, type, code) {
    task.events.push({ id: randomUUID(), at: new Date(this.clock()).toISOString(), type, code });
    if (task.events.length > 100) task.events = task.events.slice(-100);
  }

  async query(sql, params) {
    try { return await this.pool.query(sql, params); } catch (error) { throw fixed(error); }
  }

  async challenge(wallet, origin) {
    return this.transaction(async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))', ['floww_runtime.challenge-rate']);
      const now = this.clock();
      await client.query('DELETE FROM floww_runtime.challenges WHERE expires < $1', [now - 3_600_000]);
      const counts = await client.query(`SELECT count(*) AS total,
        count(*) FILTER (WHERE wallet=$1) AS wallet FROM floww_runtime.challenges WHERE created>$2`,
      [wallet, now - 60_000]);
      if (Number(counts.rows[0].wallet) >= 5 || Number(counts.rows[0].total) >= 100) fail('RATE_LIMITED', 429);
      const id = randomUUID(), expires = now + 5 * 60_000;
      let host;
      try { host = new URL(origin).host; } catch { fail('INVALID_ORIGIN', 500); }
      const message = `${host} requests a Floww sign-in.\nWallet: ${wallet}\nURI: ${origin}\nNetwork: Solana Devnet\nNonce: ${token()}\nIssued at: ${new Date(now).toISOString()}\nExpires at: ${new Date(expires).toISOString()}\nThis signature authenticates your session. It does not approve a payment.`;
      await client.query('INSERT INTO floww_runtime.challenges(id,wallet,message,expires,created) VALUES($1,$2,$3,$4,$5)',
        [id, wallet, message, expires, now]);
      return { challengeId: id, message, expiresAt: new Date(expires).toISOString() };
    });
  }

  async authenticate(id, wallet, checkSignature, ttl) {
    if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > 24 * 3_600_000) fail('INVALID_SESSION_TTL', 500);
    return this.transaction(async client => {
      const result = await client.query('SELECT * FROM floww_runtime.challenges WHERE id=$1 AND wallet=$2 FOR UPDATE', [id, wallet]);
      const challenge = result.rows[0];
      if (!challenge || challenge.consumed || Number(challenge.expires) <= this.clock()) fail('INVALID_CHALLENGE', 401);
      let verified;
      try { verified = checkSignature(challenge.message); }
      catch { fail('INVALID_SIGNATURE', 401); }
      if (thenable(verified)) { Promise.resolve(verified).catch(() => {}); fail('INVALID_SIGNATURE', 401); }
      if (verified !== true) fail('INVALID_SIGNATURE', 401);
      await client.query('UPDATE floww_runtime.challenges SET consumed=TRUE WHERE id=$1', [id]);
      await client.query('DELETE FROM floww_runtime.sessions WHERE expires<=$1', [this.clock()]);
      const value = token(), expires = this.clock() + ttl;
      await client.query('INSERT INTO floww_runtime.sessions(hash,wallet,expires) VALUES($1,$2,$3)', [hash(value), wallet, expires]);
      return { token: value, wallet, expires };
    });
  }

  async session(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
    const result = await this.query('SELECT wallet,expires FROM floww_runtime.sessions WHERE hash=$1 AND expires>$2', [hash(value), this.clock()]);
    return result.rows.length ? { wallet: result.rows[0].wallet, expires: Number(result.rows[0].expires) } : null;
  }

  async logout(value) {
    if (typeof value === 'string') await this.query('DELETE FROM floww_runtime.sessions WHERE hash=$1', [hash(value)]);
  }

  async add(task) {
    let copy;
    try { task.revision = 1; copy = structuredClone(task); } catch { fail('STATE_UNAVAILABLE', 503); }
    return this.transaction(async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))', ['floww_runtime.task-limit:' + copy.owner]);
      const counts = await client.query('SELECT count(*) AS n FROM floww_runtime.tasks WHERE owner=$1', [copy.owner]);
      if (Number(counts.rows[0].n) >= 100) fail('TASK_LIMIT_REACHED', 429);
      await client.query('INSERT INTO floww_runtime.tasks(id,owner,revision,data,created) VALUES($1,$2,$3,$4::jsonb,$5)',
        [copy.id, copy.owner, copy.revision, JSON.stringify(copy), this.clock()]);
      return copy;
    });
  }

  normalize(task) {
    const expiresAt = task.operation?.expiresAt;
    if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt) || expiresAt > this.clock()) return false;
    task.operation = null;
    if (['SIGNING', 'PENDING'].includes(task.payment)) {
      task.payment = 'UNKNOWN'; task.reasonCode = 'LEASE_EXPIRED_RECONCILE'; task.nextAction = 'RECONCILE';
      this.event(task, 'RECOVERY_REQUIRED', task.reasonCode);
    } else {
      task.reasonCode = 'OPERATION_LEASE_EXPIRED';
      task.nextAction = task.payment === 'NOT_STARTED' ? 'QUOTE'
        : task.payment === 'CONFIRMED' ? (task.result ? 'READ_RESULT' : 'RECOVER') : 'RECONCILE';
      this.event(task, 'OPERATION_STOPPED', task.reasonCode);
    }
    return true;
  }

  async save(client, task, id, owner) {
    if (task.id !== id || task.owner !== owner) fail('TASK_IDENTITY_CHANGED', 500);
    task.revision++;
    await client.query('UPDATE floww_runtime.tasks SET revision=$1,data=$2::jsonb WHERE id=$3 AND owner=$4',
      [task.revision, JSON.stringify(task), id, owner]);
    return task;
  }

  async row(client, id, owner) {
    const result = await client.query('SELECT data FROM floww_runtime.tasks WHERE id=$1 AND owner=$2 FOR UPDATE', [id, owner]);
    if (!result.rows.length) fail('TASK_NOT_FOUND', 404);
    const data = result.rows[0].data;
    return typeof data === 'string' ? JSON.parse(data) : structuredClone(data);
  }

  async get(id, owner) {
    return this.transaction(async client => {
      const task = await this.row(client, id, owner);
      if (this.normalize(task)) await this.save(client, task, id, owner);
      return task;
    });
  }

  async list(owner) {
    return this.transaction(async client => {
      const result = await client.query('SELECT data FROM floww_runtime.tasks WHERE owner=$1 ORDER BY created DESC,id DESC LIMIT 100 FOR UPDATE', [owner]);
      const tasks = result.rows.map(row => typeof row.data === 'string' ? JSON.parse(row.data) : structuredClone(row.data));
      for (const task of tasks) if (this.normalize(task)) await this.save(client, task, task.id, owner);
      return tasks;
    });
  }

  async mutate(id, owner, fn) {
    return this.transaction(async client => {
      const task = await this.row(client, id, owner);
      this.normalize(task);
      rejectAsync(fn(task));
      return this.save(client, task, id, owner);
    });
  }

  receipts = {
    get: async key => {
      const result = await this.query('SELECT data FROM floww_runtime.merchant_receipts WHERE key=$1', [key]);
      return result.rows[0]?.data ?? null;
    },
    put: async (key, data) => this.query(`INSERT INTO floww_runtime.merchant_receipts(key,state,data)
      VALUES($1,'COMPLETED',$2::jsonb) ON CONFLICT(key) DO UPDATE SET state='COMPLETED',data=EXCLUDED.data`, [key, JSON.stringify(data)]),
    claim: async key => Boolean((await this.query(`INSERT INTO floww_runtime.merchant_receipts(key,state)
      VALUES($1,'PENDING') ON CONFLICT(key) DO NOTHING RETURNING key`, [key])).rowCount),
  };

  async close() {
    if (this.ownsPool) { try { await this.pool.end(); } catch (error) { throw fixed(error); } }
  }
}
