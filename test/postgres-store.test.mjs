import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash, X509Certificate } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, chmod, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { rootCertificates } from 'node:tls';
import path from 'node:path';
import pg from 'pg';
import { PostgresStore } from '../service/postgres-store.mjs';
import { ServiceError } from '../service/config.mjs';

const exec = promisify(execFile);
let cluster, first, second, now = Date.now(), unavailable;
const clock = () => now;
const owner = () => 'test-owner-' + randomUUID();
const task = (wallet = owner()) => ({ id: randomUUID(), owner: wallet, events: [],
  operation: null, payment: 'NOT_STARTED', delivery: 'NOT_STARTED', count: 0 });
const publicCA = rootCertificates.find(pem => {
  const certificate = new X509Certificate(pem), time = Date.now();
  return certificate.ca && Date.parse(certificate.validFrom) <= time && time < Date.parse(certificate.validTo);
});

async function localTLS(root) {
  const caFile = path.join(root, 'ca.pem'), caKey = path.join(root, 'ca-key.pem');
  const certFile = path.join(root, 'server.pem'), keyFile = path.join(root, 'server-key.pem');
  const csr = path.join(root, 'server.csr'), extensions = path.join(root, 'server.ext');
  const ssl = async (stage, args) => {
    try { await exec('openssl', args, { timeout: 15_000 }); }
    catch { throw new Error('LOCAL_TLS_' + stage + '_FAILED'); }
  };
  // These private keys belong only to this fresh, disposable local test cluster.
  // exec captures OpenSSL output; no key or certificate is printed.
  await ssl('CA', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2',
    '-subj', '/CN=Floww Owned PostgreSQL Test CA', '-addext', 'basicConstraints=critical,CA:TRUE',
    '-addext', 'keyUsage=critical,keyCertSign,cRLSign', '-keyout', caKey, '-out', caFile]);
  await ssl('REQUEST', ['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=127.0.0.1',
    '-keyout', keyFile, '-out', csr]);
  await writeFile(extensions, 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:127.0.0.1\n', { mode: 0o600 });
  await ssl('SERVER', ['x509', '-req', '-in', csr, '-CA', caFile, '-CAkey', caKey,
    '-CAcreateserial', '-days', '1', '-extfile', extensions, '-out', certFile]);
  const expiredFile = path.join(root, 'expired-ca.pem');
  await ssl('EXPIRY', ['x509', '-in', caFile, '-signkey', caKey, '-days', '0', '-out', expiredFile]);
  await Promise.all([caKey, keyFile].map(file => chmod(file, 0o600)));
  return { certFile, keyFile, caPem: await readFile(caFile, 'utf8'),
    leafPem: await readFile(certFile, 'utf8'), expiredPem: await readFile(expiredFile, 'utf8') };
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function localCluster() {
  let bin;
  try { bin = execFileSync('pg_config', ['--bindir'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
  if (!['initdb', 'pg_ctl'].every(name => existsSync(path.join(bin, name))) || process.getuid?.() === 0) return null;
  const root = await mkdtemp('/tmp/floww-pg-');
  const data = path.join(root, 'data'), socket = path.join(root, 'socket'), port = await freePort();
  await mkdir(socket, { mode: 0o700 });
  const control = path.join(bin, 'pg_ctl');
  let tls;
  const stop = async () => {
    try { await exec(control, ['-D', data, '-m', 'fast', '-w', 'stop'], { timeout: 20_000 }); } catch {}
    let stopped = false;
    try { await exec(control, ['-D', data, 'status']); }
    catch (error) { stopped = error.code === 3; }
    if (!stopped) throw new Error('LOCAL_POSTGRES_NOT_STOPPED');
    await rm(root, { recursive: true, force: true });
    console.log('Stopped and removed owned PostgreSQL cluster: ' + root);
  };
  try {
    await exec(path.join(bin, 'initdb'), ['-D', data, '--no-locale', '--encoding=UTF8',
      '--auth-local=trust', '--auth-host=trust', '--username=floww_test'], { timeout: 20_000 });
    tls = await localTLS(root);
    await exec(control, ['-D', data, '-l', path.join(root, 'server.log'), '-w', '-o',
      `-h 127.0.0.1 -p ${port} -k ${socket} -c shared_buffers=16MB -c max_connections=30 -c ssl=on -c ssl_cert_file=${tls.certFile} -c ssl_key_file=${tls.keyFile}`, 'start'], { timeout: 20_000 });
  } catch (error) {
    try { await stop(); } catch {}
    throw new Error(/^LOCAL_TLS_[A-Z]+_FAILED$/.test(error.message) ? error.message : 'LOCAL_POSTGRES_SETUP_FAILED');
  }
  console.log('Started isolated PostgreSQL test cluster: ' + root);
  return { root, url: `postgresql://floww_test@127.0.0.1:${port}/postgres`, ...tls, stop };
}

before(async () => {
  cluster = await localCluster();
  if (!cluster) {
    unavailable = 'Existing non-root PostgreSQL binaries are required for real database checks';
    if (process.env.FLOWW_REQUIRE_POSTGRES_TESTS === 'true') throw new Error(unavailable);
    return;
  }
  first = await PostgresStore.open(cluster.url, { clock });
  second = await PostgresStore.open(cluster.url, { clock });
});
beforeEach(() => { now += 61_000; });
after(async () => {
  await Promise.allSettled([first?.close(), second?.close()]);
  if (cluster) await cluster.stop();
});
const real = (name, fn) => test(name, async t => {
  if (unavailable) { t.skip(unavailable); return; }
  await fn(t);
});

real('PostgreSQL limited login initializes only a pre-provisioned admin-owned schema', async () => {
  // All identifiers are generated locally, never request data. This fresh database
  // and role exist only inside the owned disposable test cluster.
  const suffix = randomUUID().replace(/-/g, '');
  const role = 'floww_limited_' + suffix, database = 'floww_limited_db_' + suffix;
  await first.pool.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`);
  await first.pool.query(`CREATE DATABASE ${database}`);
  await first.pool.query(`REVOKE ALL ON DATABASE ${database} FROM PUBLIC`);
  await first.pool.query(`GRANT CONNECT ON DATABASE ${database} TO ${role}`);
  const url = new URL(cluster.url);
  url.username = role; url.pathname = '/' + database;
  const admin = new pg.Pool({ host: '127.0.0.1', port: Number(url.port),
    database, user: 'floww_test', password: '', ssl: false });
  let limited, reopened;
  try {
    // No schema exists, and this login has no database CREATE permission.
    // Initialization must fail without escalating permissions or using public.
    await assert.rejects(PostgresStore.open(url.href, { clock, caPem: cluster.caPem }),
      error => error.code === 'STATE_UNAVAILABLE' && error.message === 'STATE_UNAVAILABLE');
    assert.equal((await admin.query("SELECT to_regnamespace('floww_runtime') AS namespace")).rows[0].namespace, null);
    await admin.query(`CREATE SCHEMA floww_runtime AUTHORIZATION floww_test;
      REVOKE ALL ON SCHEMA public FROM PUBLIC;
      GRANT USAGE, CREATE ON SCHEMA floww_runtime TO ${role}`);
    limited = await PostgresStore.open(url.href, { clock, caPem: cluster.caPem });
    const permissions = await limited.pool.query(`SELECT
      has_database_privilege(current_user,current_database(),'CREATE') AS database_create,
      rolsuper,rolcreatedb,rolcreaterole,rolinherit,rolreplication,rolbypassrls
      FROM pg_catalog.pg_roles WHERE rolname=current_user`);
    assert.ok(Object.values(permissions.rows[0]).every(value => value === false));
    const schemaOwner = await limited.pool.query(`SELECT r.rolname FROM pg_catalog.pg_namespace n
      JOIN pg_catalog.pg_roles r ON r.oid=n.nspowner WHERE n.nspname=$1`, ['floww_runtime']);
    assert.equal(schemaOwner.rows[0].rolname, 'floww_test');
    await assert.rejects(limited.pool.query('CREATE SCHEMA floww_out_of_scope'), { code: '42501' });
    await assert.rejects(limited.pool.query('CREATE TABLE public.floww_out_of_scope(id INTEGER)'), { code: '42501' });
    const value = task(); await limited.add(value);
    await limited.mutate(value.id, value.owner, current => { current.count = 7; });
    reopened = await PostgresStore.open(url.href, { clock, caPem: cluster.caPem });
    assert.equal((await reopened.get(value.id, value.owner)).count, 7);
    assert.equal((await reopened.get(value.id, value.owner)).revision, 2);
    const challenge = await reopened.challenge(value.owner, 'https://floww.example');
    const session = await limited.authenticate(challenge.challengeId, value.owner, () => true, 60_000);
    assert.equal((await reopened.session(session.token)).wallet, value.owner);
  } finally {
    await Promise.allSettled([limited?.close(), reopened?.close(), admin.end()]);
  }
});

real('PostgreSQL challenge consumption is single-use across independent pools', async () => {
  const wallet = owner(), challenge = await first.challenge(wallet, 'http://127.0.0.1:4318');
  const results = await Promise.allSettled(Array.from({ length: 8 }, (_, index) =>
    (index % 2 ? first : second).authenticate(challenge.challengeId, wallet, () => true, 60_000)));
  const successes = results.filter(result => result.status === 'fulfilled');
  assert.equal(successes.length, 1);
  assert.ok(results.filter(result => result.status === 'rejected').every(result => result.reason.code === 'INVALID_CHALLENGE'));
  const session = successes[0].value;
  assert.equal((await second.session(session.token)).wallet, wallet);
  const stored = await first.pool.query('SELECT hash FROM floww_runtime.sessions WHERE wallet=$1', [wallet]);
  assert.equal(stored.rows[0].hash, createHash('sha256').update(session.token).digest('hex'));
  assert.ok(!JSON.stringify(stored.rows).includes(session.token));
  await first.logout(session.token); assert.equal(await second.session(session.token), null);
});
real('PostgreSQL signature failures, async checks and expired challenges cannot authenticate', async () => {
  const wallet = owner(), c = await first.challenge(wallet, 'https://floww.example');
  await assert.rejects(first.authenticate(c.challengeId, wallet, () => false, 60_000), { code: 'INVALID_SIGNATURE' });
  await assert.rejects(second.authenticate(c.challengeId, wallet, async () => true, 60_000), { code: 'INVALID_SIGNATURE' });
  assert.match(c.message, /URI: https:\/\/floww\.example/);
  assert.match(c.message, /does not approve a payment/);
  now += 5 * 60_000;
  await assert.rejects(first.authenticate(c.challengeId, wallet, () => true, 60_000), { code: 'INVALID_CHALLENGE' });
});
real('PostgreSQL wallet challenge limit is atomic under concurrent requests', async () => {
  const wallet = owner();
  const results = await Promise.allSettled(Array.from({ length: 9 }, (_, i) =>
    (i % 2 ? first : second).challenge(wallet, 'https://floww.example')));
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 5);
  assert.ok(results.filter(x => x.status === 'rejected').every(x => x.reason.code === 'RATE_LIMITED'));
});
real('PostgreSQL global challenge limit is atomic across different wallets and pools', async () => {
  const results = await Promise.allSettled(Array.from({ length: 105 }, (_, i) =>
    (i % 2 ? first : second).challenge(owner(), 'https://floww.example')));
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 100);
  assert.ok(results.filter(x => x.status === 'rejected').every(x => x.reason.code === 'RATE_LIMITED'));
});
real('PostgreSQL SELECT FOR UPDATE prevents concurrent task state loss', async () => {
  const value = task(); await first.add(value);
  await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? first : second)
    .mutate(value.id, value.owner, current => { current.count++; })));
  const saved = await second.get(value.id, value.owner);
  assert.equal(saved.count, 20); assert.equal(saved.revision, 21);
});
real('PostgreSQL rejects asynchronous mutation and rolls back partial changes', async () => {
  const value = task(); await first.add(value);
  await assert.rejects(first.mutate(value.id, value.owner, async current => { current.count = 100; }),
    { code: 'ASYNC_MUTATION_NOT_ALLOWED' });
  await assert.rejects(second.mutate(value.id, value.owner, current => {
    current.count = 200; throw new ServiceError('POLICY_TEST_DENIED', 403);
  }), { code: 'POLICY_TEST_DENIED' });
  const saved = await first.get(value.id, value.owner);
  assert.equal(saved.count, 0); assert.equal(saved.revision, 1);
});
real('PostgreSQL failed multi-statement transaction rolls back and redacts raw diagnostics', async () => {
  const value = task(); await first.add(value);
  await assert.rejects(first.transaction(async client => {
    await client.query('UPDATE floww_runtime.tasks SET revision=99 WHERE id=$1', [value.id]);
    throw new Error('SECRET db provider detail');
  }), error => error.code === 'STATE_UNAVAILABLE' && !JSON.stringify(error).includes('SECRET'));
  const stored = await first.pool.query('SELECT revision FROM floww_runtime.tasks WHERE id=$1', [value.id]);
  assert.equal(Number(stored.rows[0].revision), 1);
});
real('PostgreSQL owner isolation and identity constraints survive malicious identifiers', async () => {
  const value = task(); await first.add(value);
  await assert.rejects(first.get(value.id, "x'; DELETE FROM floww_runtime.tasks; --"), { code: 'TASK_NOT_FOUND' });
  await assert.rejects(second.mutate(value.id, owner(), () => {}), { code: 'TASK_NOT_FOUND' });
  await assert.rejects(first.mutate(value.id, value.owner, current => { current.owner = owner(); }), { code: 'TASK_IDENTITY_CHANGED' });
  assert.equal((await second.get(value.id, value.owner)).owner, value.owner);
});
real('PostgreSQL 100-task cap is atomic across connections', async () => {
  const wallet = owner();
  await Promise.all(Array.from({ length: 95 }, () => first.add(task(wallet))));
  const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => (i % 2 ? first : second).add(task(wallet))));
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 5);
  assert.ok(results.filter(x => x.status === 'rejected').every(x => x.reason.code === 'TASK_LIMIT_REACHED'));
  assert.equal((await second.list(wallet)).length, 100);
});
real('PostgreSQL second startup preserves a live operation; expired signing becomes UNKNOWN', async () => {
  const value = task();
  Object.assign(value, { payment: 'SIGNING', attemptRef: 'attempt-kept', signedData: { paymentHeader: 'original-saved-proof' },
    operation: { id: 'operation-kept', kind: 'execute', expiresAt: now + 120_000 } });
  await first.add(value);
  const restarted = await PostgresStore.open(cluster.url, { clock });
  try {
    assert.equal((await restarted.get(value.id, value.owner)).operation.id, 'operation-kept');
    now += 120_001;
    const recovered = await restarted.get(value.id, value.owner);
    assert.equal(recovered.payment, 'UNKNOWN'); assert.equal(recovered.operation, null);
    assert.equal(recovered.nextAction, 'RECONCILE');
    assert.equal(recovered.attemptRef, 'attempt-kept');
    assert.deepEqual(recovered.signedData, { paymentHeader: 'original-saved-proof' });
    assert.equal((await first.get(value.id, value.owner)).payment, 'UNKNOWN');
  } finally { await restarted.close(); }
});
real('PostgreSQL expired quote and recover leases unlock without signing or losing evidence', async () => {
  for (const payment of ['NOT_STARTED', 'CONFIRMED', 'PENDING']) {
    const value = task();
    Object.assign(value, { payment, attemptRef: 'attempt-kept', signedData: { saved: true },
      operation: { id: 'expired', kind: payment === 'NOT_STARTED' ? 'quote' : 'recover', expiresAt: now - 1 } });
    await first.add(value);
    const result = (await second.list(value.owner))[0];
    assert.equal(result.operation, null); assert.deepEqual(result.signedData, { saved: true });
    assert.equal(result.nextAction, payment === 'NOT_STARTED' ? 'QUOTE' : payment === 'CONFIRMED' ? 'RECOVER' : 'RECONCILE');
    assert.equal(result.payment, payment === 'PENDING' ? 'UNKNOWN' : payment);
  }
});
real('PostgreSQL merchant receipt claims have one winner and durable completion', async () => {
  const key = 'receipt-' + randomUUID();
  const results = await Promise.all(Array.from({ length: 10 }, (_, i) => (i % 2 ? first : second).receipts.claim(key)));
  assert.equal(results.filter(Boolean).length, 1); assert.equal(await first.receipts.get(key), null);
  await second.receipts.put(key, { transaction: 'saved-transaction', bodyDigest: 'body-hash' });
  assert.deepEqual(await first.receipts.get(key), { transaction: 'saved-transaction', bodyDigest: 'body-hash' });
  assert.equal(await first.receipts.claim(key), false);
});

function fakePool(query) {
  return { on() {}, ended: false, released: [],
    async connect() { return { query, release: error => this.released.push(error) }; },
    query, async end() { this.ended = true; } };
}
test('PostgreSQL remote TLS cannot be weakened by connection-string sslmode', async () => {
  let captured;
  const pool = fakePool(async () => ({ rows: [] }));
  const store = await PostgresStore.open('postgresql://test-user:dummy-value@db.example.test/new-db?sslmode=require', {
    poolFactory: config => { captured = config; return pool; },
  });
  assert.deepEqual(captured.ssl, { rejectUnauthorized: true });
  assert.equal(captured.connectionString, undefined);
  await store.close(); assert.equal(pool.ended, true);
  await assert.rejects(PostgresStore.open('postgresql://test-user:dummy-value@db.example.test/new-db?sslmode=disable', {
    poolFactory: () => { throw new Error('must not connect'); },
  }), { code: 'DATABASE_TLS_REQUIRED' });
});
test('PostgreSQL explicit CA is the only added trust and URL parameters cannot override it', async () => {
  assert.ok(publicCA);
  let captured;
  const pool = fakePool(async () => ({ rows: [] }));
  const url = 'postgresql://test-user@db.example.test/new-db?sslmode=require&sslrootcert=/not-read&sslcert=/not-read&sslkey=/not-read&ssl=false&rejectUnauthorized=false';
  const store = await PostgresStore.open(url, {
    caPem: '\n' + publicCA.replace(/\n/g, '\r\n') + '\n',
    poolFactory: config => { captured = config; return pool; },
  });
  assert.deepEqual(captured.ssl, { rejectUnauthorized: true, ca: new X509Certificate(publicCA).toString() });
  assert.equal(captured.connectionString, undefined);
  assert.equal(captured.ssl.checkServerIdentity, undefined);
  await store.close();
  for (const sslmode of ['disable', 'allow', 'prefer', 'no-verify']) {
    await assert.rejects(PostgresStore.open(url.replace('sslmode=require', 'sslmode=' + sslmode), {
      caPem: publicCA, poolFactory: () => { assert.fail('TLS bypass must not construct a pool'); },
    }), { code: 'DATABASE_TLS_REQUIRED' });
  }
});
test('PostgreSQL unset CA preserves defaults and explicit loopback CA enforces TLS', async () => {
  for (const caPem of [undefined, null, '']) {
    for (const [host, expected] of [['127.0.0.1', false], ['db.example.test', { rejectUnauthorized: true }]]) {
      let captured;
      const store = await PostgresStore.open(`postgresql://test-user@${host}/new-db`, {
        caPem, poolFactory: config => { captured = config; return fakePool(async () => ({ rows: [] })); },
      });
      assert.deepEqual(captured.ssl, expected); await store.close();
    }
  }
  let captured;
  const store = await PostgresStore.open('postgresql://test-user@127.0.0.1/new-db', {
    caPem: publicCA, poolFactory: config => { captured = config; return fakePool(async () => ({ rows: [] })); },
  });
  assert.deepEqual(captured.ssl, { rejectUnauthorized: true, ca: new X509Certificate(publicCA).toString() });
  await store.close();
  await assert.rejects(PostgresStore.open('postgresql://test-user@127.0.0.1/new-db?sslmode=disable', {
    caPem: publicCA, poolFactory: () => { assert.fail('explicit CA must not permit plaintext'); },
  }), { code: 'DATABASE_TLS_REQUIRED' });
});
test('PostgreSQL malformed, bundled and oversized CA inputs fail before any connection', async () => {
  const cert = new X509Certificate(publicCA);
  const trailingDer = Buffer.concat([cert.raw, Buffer.from('unexpected')]).toString('base64');
  const invalid = [' ', 'SECRET-not-a-certificate', '/private/not-read.pem', publicCA + publicCA,
    '-----BEGIN PRIVATE KEY-----\nSECRET\n-----END PRIVATE KEY-----',
    '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----',
    `-----BEGIN CERTIFICATE-----\n${trailingDer}\n-----END CERTIFICATE-----`,
    publicCA + ' '.repeat(65_536), 42, {}, Buffer.from(publicCA)];
  for (const caPem of invalid) {
    let created = false;
    await assert.rejects(PostgresStore.open('postgresql://test-user@db.example.test/new-db', {
      caPem, poolFactory: () => { created = true; return fakePool(async () => ({ rows: [] })); },
    }), error => error.code === 'INVALID_DATABASE_CA' && error.message === 'INVALID_DATABASE_CA'
      && !JSON.stringify(error).includes('SECRET'));
    assert.equal(created, false);
  }
});
real('PostgreSQL explicit CA verifies a real TLS connection and rejects the wrong authority', async () => {
  const secure = await PostgresStore.open(cluster.url + '?sslmode=require&sslrootcert=/not-read', { caPem: cluster.caPem, clock });
  try {
    const result = await secure.pool.query('SELECT ssl,version FROM pg_stat_ssl WHERE pid=pg_backend_pid()');
    assert.equal(result.rows[0].ssl, true); assert.match(result.rows[0].version, /^TLSv1\.[23]$/);
    const wallet = owner(), challenge = await secure.challenge(wallet, 'https://floww.example');
    assert.equal(typeof challenge.challengeId, 'string');
  } finally { await secure.close(); }
  await assert.rejects(PostgresStore.open(cluster.url, { caPem: publicCA }),
    error => error.code === 'STATE_UNAVAILABLE' && error.message === 'STATE_UNAVAILABLE');
});
real('PostgreSQL non-CA and expired X509 certificates fail before connecting', async () => {
  for (const caPem of [cluster.leafPem, cluster.expiredPem]) {
    let created = false;
    await assert.rejects(PostgresStore.open(cluster.url, {
      caPem, poolFactory: () => { created = true; return fakePool(async () => ({ rows: [] })); },
    }), { code: 'INVALID_DATABASE_CA' });
    assert.equal(created, false);
  }
});
test('PostgreSQL initialization and rollback failures release connections without raw secrets', async () => {
  const pool = fakePool(async () => { throw new Error('SECRET provider connection detail'); });
  await assert.rejects(PostgresStore.open('postgresql://test-user@127.0.0.1/new-db', { poolFactory: () => pool }),
    error => error.code === 'STATE_UNAVAILABLE' && !JSON.stringify(error).includes('SECRET'));
  assert.equal(pool.released.length, 1); assert.equal(pool.ended, true);
  const broken = fakePool(async sql => {
    if (sql === 'BEGIN') return { rows: [] };
    throw new Error('SECRET rollback failed');
  });
  const store = new PostgresStore(broken, clock);
  await assert.rejects(store.transaction(() => { throw new Error('SECRET action'); }), { code: 'STATE_UNAVAILABLE' });
  assert.equal(broken.released[0].message, 'STATE_UNAVAILABLE');
});

real('PostgreSQL task idempotency has one owner-scoped winner across independent pools', async () => {
  const wallet = owner(), options = { idempotencyKey: 'same-client-request', bodyHash: 'a'.repeat(64) };
  const responses = await Promise.all(Array.from({ length: 8 }, (_, index) =>
    (index % 2 ? first : second).add(task(wallet), options)));
  assert.equal(new Set(responses.map(value => value.id)).size, 1);
  assert.equal((await first.dashboard(wallet)).total, 1);
  await assert.rejects(second.add(task(wallet), { ...options, bodyHash: 'b'.repeat(64) }), { code: 'IDEMPOTENCY_CONFLICT' });
  const reopened = await PostgresStore.open(cluster.url, { clock });
  try { assert.equal((await reopened.add(task(wallet), options)).id, responses[0].id); }
  finally { await reopened.close(); }
  const other = await second.add(task(owner()), options); assert.notEqual(other.id, responses[0].id);
});
real('PostgreSQL summary cursor pages and dashboard stay scoped and exclude large private reports', async () => {
  const wallet = owner(), ids = [];
  for (let i = 0; i < 45; i++) {
    const value = task(wallet); ids.push(value.id);
    value.payment = 'CONFIRMED'; value.delivery = 'COMPLETED';
    value.result = { answer: { summary: 'fixture only' }, html: 'large-private-result'.repeat(1000) };
    value.signedData = { paymentHeader: 'private-proof' }; value.deliveredBody = 'merchant-body';
    await first.add(value);
  }
  ids.sort().reverse();
  const a = await first.page(wallet), b = await second.page(wallet, { cursor: a.nextCursor }),
    c = await first.page(wallet, { cursor: b.nextCursor });
  assert.deepEqual([...a.tasks, ...b.tasks, ...c.tasks].map(task => task.id), ids);
  assert.equal(a.tasks.length, 20); assert.equal(b.tasks.length, 20); assert.equal(c.tasks.length, 5);
  assert.equal(c.nextCursor, null); assert.ok(a.tasks.every(task => task.resultAvailable));
  assert.doesNotMatch(JSON.stringify(a), /large-private-result|private-proof|merchant-body|"result"|"html"|"signedData"/);
  await assert.rejects(first.page(owner(), { cursor: a.nextCursor }), { code: 'INVALID_CURSOR' });
  await assert.rejects(first.page(wallet, { limit: 51 }), { code: 'INVALID_PAGE' });
  await first.archive(ids[0], wallet);
  assert.equal((await second.page(wallet)).tasks[0].id, ids[1]);
  assert.equal((await second.page(wallet, { includeArchived: true })).tasks[0].id, ids[0]);
  const stats = await first.dashboard(wallet);
  assert.equal(stats.total, 45); assert.equal(stats.active, 44); assert.equal(stats.archived, 1);
  assert.equal(stats.resultAvailable, 45); assert.equal(stats.payment.CONFIRMED, 45);
  assert.equal((await second.get(ids[0], wallet)).signedData.paymentHeader, 'private-proof');
});
real('PostgreSQL active capacity is atomic across creation and restore and cannot archive uncertainty', async () => {
  const wallet = owner(), values = Array.from({ length: 100 }, () => task(wallet));
  for (const value of values) await first.add(value);
  await first.archive(values[0].id, wallet);
  const race = await Promise.allSettled([first.restore(values[0].id, wallet), second.add(task(wallet))]);
  assert.equal(race.filter(value => value.status === 'fulfilled').length, 1);
  assert.equal(race.filter(value => value.status === 'rejected')[0].reason.code, 'TASK_LIMIT_REACHED');
  assert.equal((await first.dashboard(wallet)).active, 100);
  await first.mutate(values[1].id, wallet, task => { task.payment = 'UNKNOWN'; task.signedData = { paymentHeader: 'original' }; });
  await assert.rejects(second.archive(values[1].id, wallet), { code: 'TASK_UNRESOLVED' });
  assert.equal((await first.get(values[1].id, wallet)).signedData.paymentHeader, 'original');
  await assert.rejects(second.archive(values[1].id, owner()), { code: 'TASK_NOT_FOUND' });
});
real('PostgreSQL task workspace authority is immutable under rejected or async mutations', async () => {
  const value = task(); value.workspaceContext = { conversationId: 'owned-conversation', planHash: 'a'.repeat(64) };
  await first.add(value);
  await assert.rejects(second.mutate(value.id, value.owner, task => { task.workspaceContext.planHash = 'changed'; }), { code: 'TASK_IDENTITY_CHANGED' });
  await assert.rejects(second.mutate(value.id, value.owner, task => { task.workspaceContext = undefined; }), { code: 'TASK_IDENTITY_CHANGED' });
  assert.equal((await first.get(value.id, value.owner)).workspaceContext.planHash, 'a'.repeat(64));
});
