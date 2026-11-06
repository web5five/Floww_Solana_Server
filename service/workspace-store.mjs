import { randomUUID, createHash } from 'node:crypto';
import { fail, ServiceError } from './config.mjs';

const KINDS = new Set(['conversation', 'memory']);
const bytes = data => Buffer.byteLength(JSON.stringify(data));
const copy = value => structuredClone(value);
const safe = error => error instanceof ServiceError ? error : new ServiceError('WORKSPACE_UNAVAILABLE', 503);
const check = (owner, kind) => {
  if (typeof owner !== 'string' || !owner || owner.length > 160 || !KINDS.has(kind)) fail('INVALID_WORKSPACE_REQUEST');
};
const summary = (kind, data) => kind === 'memory' ? data : {
  title: data.title, status: data.status, intent: data.intent,
  linkedTaskId: data.linkedTaskId ?? null, messageCount: data.messages?.length ?? 0,
};
const validateData = (kind, data) => {
  if (!data || typeof data !== 'object' || Array.isArray(data) || bytes(data) > (kind === 'memory' ? 8_000 : 256_000)) fail('WORKSPACE_RECORD_TOO_LARGE', 413);
};
const unpack = row => ({ id: row.id, kind: row.kind, revision: Number(row.revision),
  createdAt: new Date(Number(row.created)).toISOString(), updatedAt: new Date(Number(row.updated)).toISOString(),
  data: typeof row.data === 'string' ? JSON.parse(row.data) : copy(row.data) });

/** Owner-scoped durable workspace aggregates. Model context uses a bounded view. */
export class WorkspaceStore {
  static async open(store) {
    const repo = new WorkspaceStore(store);
    if (repo.pg) await store.transaction(async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('floww_runtime.workspace.v1',0))");
      await client.query(`CREATE TABLE IF NOT EXISTS floww_runtime.workspace_records (
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('conversation','memory')),
        revision BIGINT NOT NULL, created BIGINT NOT NULL, updated BIGINT NOT NULL,
        expires BIGINT, deleted BOOLEAN NOT NULL DEFAULT FALSE, data JSONB NOT NULL, summary JSONB NOT NULL);
        CREATE INDEX IF NOT EXISTS workspace_owner_kind_created ON floww_runtime.workspace_records(owner,kind,created DESC,id DESC);
        CREATE TABLE IF NOT EXISTS floww_runtime.workspace_audit(id TEXT PRIMARY KEY,owner TEXT NOT NULL,type TEXT NOT NULL,record_id TEXT NOT NULL,revision BIGINT NOT NULL,created BIGINT NOT NULL);
        CREATE INDEX IF NOT EXISTS workspace_audit_owner_created ON floww_runtime.workspace_audit(owner,created DESC,id DESC);
        CREATE TABLE IF NOT EXISTS floww_runtime.workspace_model_usage(bucket TEXT PRIMARY KEY,used BIGINT NOT NULL);`);
    });
    else store.db.exec(`CREATE TABLE IF NOT EXISTS workspace_records (
      id TEXT PRIMARY KEY, owner TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('conversation','memory')),
      revision INTEGER NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL,
      expires INTEGER, deleted INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL, summary TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS workspace_owner_kind_created ON workspace_records(owner,kind,created DESC,id DESC);
      CREATE TABLE IF NOT EXISTS workspace_audit(id TEXT PRIMARY KEY,owner TEXT NOT NULL,type TEXT NOT NULL,record_id TEXT NOT NULL,revision INTEGER NOT NULL,created INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS workspace_audit_owner_created ON workspace_audit(owner,created DESC,id DESC);
      CREATE TABLE IF NOT EXISTS workspace_model_usage(bucket TEXT PRIMARY KEY,used INTEGER NOT NULL);`);
    return repo;
  }
  constructor(store) { this.store = store; this.pg = Boolean(store.pool); this.clock = () => store.clock(); }
  async create(owner, kind, data) {
    check(owner, kind); validateData(kind, data);
    const now = this.clock(), id = randomUUID(), expires = kind === 'memory' ? Date.parse(data.expiresAt) : null;
    if (kind === 'memory' && (!Number.isFinite(expires) || expires <= now)) fail('INVALID_MEMORY_EXPIRY');
    const values = [id, owner, kind, 1, now, now, expires, JSON.stringify(data), JSON.stringify(summary(kind, data))];
    try {
      if (this.pg) return await this.store.transaction(async client => {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))', ['workspace-limit:' + owner + ':' + kind]);
        const count = await client.query('SELECT count(*) AS n FROM floww_runtime.workspace_records WHERE owner=$1 AND kind=$2 AND NOT deleted AND (expires IS NULL OR expires>$3)', [owner, kind, now]);
        if (Number(count.rows[0].n) >= (kind === 'memory' ? 200 : 500)) fail('WORKSPACE_LIMIT_REACHED', 429);
        const result = await client.query(`INSERT INTO floww_runtime.workspace_records(id,owner,kind,revision,created,updated,expires,data,summary)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb) RETURNING *`, values);
        await this.auditPg(client, owner, kind.toUpperCase() + '_CREATED', id, 1);
        return unpack(result.rows[0]);
      });
      return this.store.transaction(() => {
        const count = this.store.db.prepare('SELECT count(*) AS n FROM workspace_records WHERE owner=? AND kind=? AND deleted=0 AND (expires IS NULL OR expires>?)').get(owner, kind, now).n;
        if (count >= (kind === 'memory' ? 200 : 500)) fail('WORKSPACE_LIMIT_REACHED', 429);
        this.store.db.prepare('INSERT INTO workspace_records(id,owner,kind,revision,created,updated,expires,data,summary) VALUES(?,?,?,?,?,?,?,?,?)').run(...values);
        this.auditSqlite(owner, kind.toUpperCase() + '_CREATED', id, 1);
        return { id, kind, revision: 1, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), data: copy(data) };
      });
    } catch (error) { throw safe(error); }
  }
  async get(owner, kind, id) {
    check(owner, kind);
    let row;
    try {
      if (this.pg) row = (await this.store.query('SELECT * FROM floww_runtime.workspace_records WHERE id=$1 AND owner=$2 AND kind=$3 AND NOT deleted AND (expires IS NULL OR expires>$4)', [id, owner, kind, this.clock()])).rows[0];
      else row = this.store.db.prepare('SELECT * FROM workspace_records WHERE id=? AND owner=? AND kind=? AND deleted=0 AND (expires IS NULL OR expires>?)').get(id, owner, kind, this.clock());
    } catch (error) { throw safe(error); }
    if (!row) fail('WORKSPACE_NOT_FOUND', 404);
    return unpack(row);
  }
  async update(owner, kind, id, expectedRevision, change) {
    check(owner, kind);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1 || typeof change !== 'function') fail('INVALID_REVISION');
    const apply = row => {
      if (!row || row.deleted || (row.expires !== null && Number(row.expires) <= this.clock())) fail('WORKSPACE_NOT_FOUND', 404);
      const record = unpack(row);
      if (record.revision !== expectedRevision) fail('WORKSPACE_CHANGED', 409);
      const effect = change(record.data, record);
      if (effect && typeof effect.then === 'function') { Promise.resolve(effect).catch(() => {}); fail('ASYNC_MUTATION_NOT_ALLOWED', 500); }
      validateData(kind, record.data);
      if (kind === 'memory' && Date.parse(record.data.expiresAt) !== Number(row.expires)) fail('MEMORY_EXPIRY_IMMUTABLE', 409);
      return { ...record, revision: expectedRevision + 1, updatedAt: new Date(this.clock()).toISOString() };
    };
    try {
      if (this.pg) return await this.store.transaction(async client => {
        const rows = await client.query('SELECT * FROM floww_runtime.workspace_records WHERE id=$1 AND owner=$2 AND kind=$3 FOR UPDATE', [id, owner, kind]);
        const record = apply(rows.rows[0]);
        await client.query('UPDATE floww_runtime.workspace_records SET revision=$1,updated=$2,data=$3::jsonb,summary=$4::jsonb WHERE id=$5 AND owner=$6 AND kind=$7',
          [record.revision, Date.parse(record.updatedAt), JSON.stringify(record.data), JSON.stringify(summary(kind, record.data)), id, owner, kind]);
        await this.auditPg(client, owner, kind.toUpperCase() + '_UPDATED', id, record.revision);
        return record;
      });
      return this.store.transaction(() => {
        const row = this.store.db.prepare('SELECT * FROM workspace_records WHERE id=? AND owner=? AND kind=?').get(id, owner, kind);
        const record = apply(row);
        this.store.db.prepare('UPDATE workspace_records SET revision=?,updated=?,data=?,summary=? WHERE id=? AND owner=? AND kind=?').run(record.revision,
          Date.parse(record.updatedAt), JSON.stringify(record.data), JSON.stringify(summary(kind, record.data)), id, owner, kind);
        this.auditSqlite(owner, kind.toUpperCase() + '_UPDATED', id, record.revision);
        return record;
      });
    } catch (error) { throw safe(error); }
  }
  async remove(owner, kind, id, expectedRevision) {
    check(owner, kind);
    if (kind !== 'memory' || !Number.isInteger(expectedRevision)) fail('INVALID_WORKSPACE_REQUEST');
    try {
      if (this.pg) return await this.store.transaction(async client => {
        const rows = await client.query('SELECT revision,deleted FROM floww_runtime.workspace_records WHERE id=$1 AND owner=$2 AND kind=$3 FOR UPDATE', [id, owner, kind]);
        const row = rows.rows[0];
        if (!row || row.deleted) fail('WORKSPACE_NOT_FOUND', 404);
        if (Number(row.revision) !== expectedRevision) fail('WORKSPACE_CHANGED', 409);
        await client.query('UPDATE floww_runtime.workspace_records SET deleted=TRUE,revision=revision+1,updated=$1 WHERE id=$2 AND owner=$3 AND kind=$4', [this.clock(), id, owner, kind]);
        await this.auditPg(client, owner, 'MEMORY_REMOVED', id, expectedRevision + 1);
      });
      return this.store.transaction(() => {
        const row = this.store.db.prepare('SELECT revision,deleted FROM workspace_records WHERE id=? AND owner=? AND kind=?').get(id, owner, kind);
        if (!row || row.deleted) fail('WORKSPACE_NOT_FOUND', 404);
        if (Number(row.revision) !== expectedRevision) fail('WORKSPACE_CHANGED', 409);
        this.store.db.prepare('UPDATE workspace_records SET deleted=1,revision=revision+1,updated=? WHERE id=? AND owner=? AND kind=?').run(this.clock(), id, owner, kind);
        this.auditSqlite(owner, 'MEMORY_REMOVED', id, expectedRevision + 1);
      });
    } catch (error) { throw safe(error); }
  }
  auditSqlite(owner, type, id, revision) {
    this.store.db.prepare('INSERT INTO workspace_audit(id,owner,type,record_id,revision,created) VALUES(?,?,?,?,?,?)').run(randomUUID(), owner, type, id, revision, this.clock());
  }
  async auditPg(client, owner, type, id, revision) {
    await client.query('INSERT INTO floww_runtime.workspace_audit(id,owner,type,record_id,revision,created) VALUES($1,$2,$3,$4,$5,$6)', [randomUUID(), owner, type, id, revision, this.clock()]);
  }
  async counts(owner) {
    try {
      const rows = this.pg ? (await this.store.query('SELECT kind,count(*) AS n FROM floww_runtime.workspace_records WHERE owner=$1 AND NOT deleted AND (expires IS NULL OR expires>$2) GROUP BY kind', [owner, this.clock()])).rows
        : this.store.db.prepare('SELECT kind,count(*) AS n FROM workspace_records WHERE owner=? AND deleted=0 AND (expires IS NULL OR expires>?) GROUP BY kind').all(owner, this.clock());
      return Object.fromEntries(['conversation', 'memory'].map(kind => [kind, Number(rows.find(row => row.kind === kind)?.n ?? 0)]));
    } catch (error) { throw safe(error); }
  }
  async activity(owner, limit = 30) {
    if (typeof owner !== 'string' || !Number.isInteger(limit) || limit < 1 || limit > 50) fail('INVALID_PAGE');
    try {
      const rows = this.pg ? (await this.store.query('SELECT id,type,record_id,revision,created FROM floww_runtime.workspace_audit WHERE owner=$1 ORDER BY created DESC,id DESC LIMIT $2', [owner, limit])).rows
        : this.store.db.prepare('SELECT id,type,record_id,revision,created FROM workspace_audit WHERE owner=? ORDER BY created DESC,id DESC LIMIT ?').all(owner, limit);
      return rows.map(row => ({ id: row.id, type: row.type, recordId: row.record_id, revision: Number(row.revision), at: new Date(Number(row.created)).toISOString() }));
    } catch (error) { throw safe(error); }
  }
  async reserveModel(owner, calls, { globalLimit = 60, ownerLimit = 20 } = {}) {
    if (typeof owner !== 'string' || !Number.isInteger(calls) || calls < 1 || calls > 3 ||
      !Number.isInteger(globalLimit) || globalLimit < 1 || !Number.isInteger(ownerLimit) || ownerLimit < 1) fail('INVALID_MODEL_LIMIT');
    const day = new Date(this.clock()).toISOString().slice(0, 10);
    const buckets = [day + ':global', day + ':owner:' + owner], limits = [globalLimit, ownerLimit];
    try {
      if (this.pg) return await this.store.transaction(async client => {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))', ['workspace-model:' + day]);
        for (let i = 0; i < 2; i++) {
          const rows = await client.query('SELECT used FROM floww_runtime.workspace_model_usage WHERE bucket=$1 FOR UPDATE', [buckets[i]]);
          if (Number(rows.rows[0]?.used ?? 0) + calls > limits[i]) fail('MODEL_DAILY_LIMIT', 429);
          await client.query('INSERT INTO floww_runtime.workspace_model_usage(bucket,used) VALUES($1,$2) ON CONFLICT(bucket) DO UPDATE SET used=floww_runtime.workspace_model_usage.used+EXCLUDED.used', [buckets[i], calls]);
        }
      });
      return this.store.transaction(() => {
        for (let i = 0; i < 2; i++) {
          const row = this.store.db.prepare('SELECT used FROM workspace_model_usage WHERE bucket=?').get(buckets[i]);
          if (Number(row?.used ?? 0) + calls > limits[i]) fail('MODEL_DAILY_LIMIT', 429);
          this.store.db.prepare('INSERT INTO workspace_model_usage(bucket,used) VALUES(?,?) ON CONFLICT(bucket) DO UPDATE SET used=used+excluded.used').run(buckets[i], calls);
        }
      });
    } catch (error) { throw safe(error); }
  }
  async voiceContext(owner, id, expectedRevision) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) fail('INVALID_VOICE_REQUEST');
    const record = await this.get(owner, 'conversation', id);
    if (!Number.isSafeInteger(record.revision) || record.revision < 1) fail('WORKSPACE_UNAVAILABLE', 503);
    if (record.revision !== expectedRevision) fail('WORKSPACE_CHANGED', 409);
    const bound = this.pg ? (await this.store.query(`SELECT 1 FROM floww_runtime.tasks
      WHERE id=$1 AND owner=$2 AND data#>>'{workspaceContext,conversationId}'=$1 LIMIT 1`, [id, owner])).rows.length > 0
      : Boolean(this.store.db.prepare(`SELECT 1 FROM tasks WHERE id=? AND owner=?
        AND json_extract(data,'$.workspaceContext.conversationId')=? LIMIT 1`).get(id, owner, id));
    if (record.data.linkedTaskId || record.data.confirmation || bound) fail('CONVERSATION_ALREADY_LINKED', 409);
    if (record.data.operation) {
      if (!Number.isSafeInteger(record.data.operation.expiresAt)) fail('WORKSPACE_UNAVAILABLE', 503);
      if (record.data.operation.expiresAt > this.clock()) fail('CONVERSATION_BUSY', 409);
    }
    return { id: record.id, revision: record.revision };
  }
  async reserveVoice(owner, seconds, { globalCalls = 30, ownerCalls = 10, globalSeconds = 600, ownerSeconds = 180 } = {}) {
    if (typeof owner !== 'string' || !owner || owner.length > 160 || !Number.isSafeInteger(seconds) || seconds < 1 || seconds > 60 ||
        !Number.isSafeInteger(globalCalls) || globalCalls < 1 || globalCalls > 1000 ||
        !Number.isSafeInteger(ownerCalls) || ownerCalls < 1 || ownerCalls > globalCalls ||
        !Number.isSafeInteger(globalSeconds) || globalSeconds < 1 || globalSeconds > 3600 ||
        !Number.isSafeInteger(ownerSeconds) || ownerSeconds < 1 || ownerSeconds > globalSeconds) fail('INVALID_VOICE_REQUEST');
    const day = new Date(this.clock()).toISOString().slice(0, 10), prefix = 'voice:v1:' + day;
    const ownerDigest = createHash('sha256').update(owner).digest('hex');
    const buckets = [prefix + ':global:calls', prefix + ':owner:' + ownerDigest + ':calls',
      prefix + ':global:seconds', prefix + ':owner:' + ownerDigest + ':seconds'];
    const increments = [1, 1, seconds, seconds], limits = [globalCalls, ownerCalls, globalSeconds, ownerSeconds];
    const used = value => {
      if (value === undefined) return 0;
      if (typeof value === 'string' && /^(0|[1-9][0-9]{0,15})$/.test(value)) value = Number(value);
      if (!Number.isSafeInteger(value) || value < 0) fail('VOICE_QUOTA_UNAVAILABLE', 503);
      return value;
    };
    try {
      if (this.pg) return await this.store.transaction(async client => {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))', ['workspace-voice:v1:' + day]);
        const values = [];
        for (let i = 0; i < buckets.length; i++) {
          const rows = await client.query('SELECT used FROM floww_runtime.workspace_model_usage WHERE bucket=$1 FOR UPDATE', [buckets[i]]);
          const prior = used(rows.rows[0]?.used);
          if (prior > limits[i] - increments[i]) fail('VOICE_DAILY_LIMIT', 429);
          values.push(prior + increments[i]);
        }
        for (let i = 0; i < buckets.length; i++) await client.query(`INSERT INTO floww_runtime.workspace_model_usage(bucket,used) VALUES($1,$2)
          ON CONFLICT(bucket) DO UPDATE SET used=EXCLUDED.used`, [buckets[i], values[i]]);
      });
      return this.store.transaction(() => {
        const values = buckets.map((bucket, i) => {
          const prior = used(this.store.db.prepare('SELECT used FROM workspace_model_usage WHERE bucket=?').get(bucket)?.used);
          if (prior > limits[i] - increments[i]) fail('VOICE_DAILY_LIMIT', 429);
          return prior + increments[i];
        });
        for (let i = 0; i < buckets.length; i++) this.store.db.prepare(`INSERT INTO workspace_model_usage(bucket,used) VALUES(?,?)
          ON CONFLICT(bucket) DO UPDATE SET used=excluded.used`).run(buckets[i], values[i]);
      });
    } catch (error) {
      if (error instanceof ServiceError && ['VOICE_DAILY_LIMIT', 'VOICE_QUOTA_UNAVAILABLE'].includes(error.code)) throw error;
      fail('VOICE_QUOTA_UNAVAILABLE', 503);
    }
  }
  async page(owner, kind, { limit = 20, cursor } = {}) {
    check(owner, kind);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) fail('INVALID_PAGE');
    let boundary;
    if (cursor !== undefined && cursor !== null) {
      try {
        if (typeof cursor !== 'string' || cursor.length > 300 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
        boundary = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
        if (!Array.isArray(boundary) || boundary.length !== 2 || !Number.isSafeInteger(boundary[0]) ||
          typeof boundary[1] !== 'string' || !/^[a-f0-9-]{36}$/.test(boundary[1])) throw new Error();
      } catch { fail('INVALID_CURSOR'); }
    }
    let rows;
    try {
      if (this.pg) rows = (await this.store.query(`SELECT id,kind,revision,created,updated,summary AS data FROM floww_runtime.workspace_records
        WHERE owner=$1 AND kind=$2 AND NOT deleted AND (expires IS NULL OR expires>$3)
        ${boundary ? 'AND (created<$4 OR (created=$4 AND id<$5))' : ''}
        ORDER BY created DESC,id DESC LIMIT $${boundary ? 6 : 4}`, [owner, kind, this.clock(), ...(boundary || []), limit + 1])).rows;
      else rows = this.store.db.prepare(`SELECT id,kind,revision,created,updated,summary AS data FROM workspace_records
        WHERE owner=? AND kind=? AND deleted=0 AND (expires IS NULL OR expires>?)
        ${boundary ? 'AND (created<? OR (created=? AND id<?))' : ''}
        ORDER BY created DESC,id DESC LIMIT ?`).all(owner, kind, this.clock(), ...(boundary ? [boundary[0], boundary[0], boundary[1]] : []), limit + 1);
    } catch (error) { throw safe(error); }
    const page = rows.slice(0, limit), last = page.at(-1);
    return { items: page.map(unpack), nextCursor: rows.length > limit && last
      ? Buffer.from(JSON.stringify([Number(last.created), last.id])).toString('base64url') : null };
  }
}
