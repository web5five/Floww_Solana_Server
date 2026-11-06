import { Worker } from 'node:worker_threads';
import { Store } from './store.mjs';
import { PostgresStore } from './postgres-store.mjs';
import { adminQueries, freezeAdminData, projectAdminSource, readySource, unavailableSource, utcDays } from './admin-data.mjs';

const names = ['tasks', 'usage', 'executions', 'events'];
const empty = code => Object.fromEntries(names.map(name => [name, unavailableSource(name, code)]));

async function readPostgres(store, { days, limitPerDay, publish, clock }) {
  let client, begun = false, releaseError;
  try {
    // Reuse the bounded runtime pool. Single-flight permits at most one queued
    // operator acquisition; an HTTP timeout never launches a replacement query.
    client = await store.pool.connect();
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'); begun = true;
    await client.query("SET LOCAL statement_timeout='750ms'");
    await client.query("SET LOCAL lock_timeout='200ms'");
    const queries = adminQueries('postgres', days), started = performance.now();
    for (const name of names) {
      if (performance.now() - started >= 1800) { publish(name, unavailableSource(name, 'ADMIN_SOURCE_TIMEOUT')); continue; }
      await client.query('SAVEPOINT admin_source');
      try {
        const query = queries[name], result = await client.query(query.text, query.values);
        publish(name, readySource(name, projectAdminSource(name, result.rows, days, limitPerDay), new Date(clock()).toISOString()));
        await client.query('RELEASE SAVEPOINT admin_source');
      } catch (error) {
        await client.query('ROLLBACK TO SAVEPOINT admin_source');
        await client.query('RELEASE SAVEPOINT admin_source');
        publish(name, unavailableSource(name, error?.code === '57014' || error?.code === '55P03' ? 'ADMIN_SOURCE_TIMEOUT' : 'ADMIN_SOURCE_UNAVAILABLE'));
      }
    }
    await client.query('ROLLBACK'); begun = false;
  } catch {
    // A rejected BEGIN may have reached the server before the client observed
    // its failure. Never return an ambiguously admitted transaction as reusable.
    releaseError = new Error('ADMIN_SOURCE_UNAVAILABLE');
    throw releaseError;
  } finally {
    if (client && begun) { try { await client.query('ROLLBACK'); } catch { releaseError = new Error('ADMIN_SOURCE_UNAVAILABLE'); } }
    // A broken transaction is discarded by the existing pool, never returned
    // as an apparently reusable client. No other database session is touched.
    client?.release(releaseError);
  }
}
function readSqlite(store, { days, limitPerDay, publish, registerCancel, workerFactory }) {
  const source = store.adminReadSource;
  if (!source?.path) return Promise.resolve();
  return new Promise(resolve => {
    let child;
    try { child = workerFactory(new URL('./admin-sqlite-worker.mjs', import.meta.url), {
      workerData: { source, days, limitPerDay }, stdout: true, stderr: true,
      env: {}, execArgv: [], argv: [],
      resourceLimits: { maxOldGenerationSizeMb: 32, maxYoungGenerationSizeMb: 8, stackSizeMb: 2 },
    }); } catch { resolve(); return; }
    // No native/database diagnostic reaches process logs or an administrator.
    child.stdout?.resume(); child.stderr?.resume();
    const cancel = () => { try { Promise.resolve(child.terminate()).catch(() => {}); } catch {} };
    registerCancel(cancel);
    child.on('message', message => {
      if (names.includes(message?.name)) publish(message.name, message.source);
    });
    child.once('error', () => { cancel(); });
    child.once('exit', () => { child.stdout?.destroy(); child.stderr?.destroy(); resolve(); });
  });
}

/** One redacted cached snapshot, one actual query/worker flight per runtime. */
export function createAdminReader({ store, lifecycle, limitPerDay = 60, clock = Date.now,
  timeoutMs = 2000, cacheMs = 5000, workerFactory = (url, options) => new Worker(url, options) }) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2000 ||
      !Number.isSafeInteger(cacheMs) || cacheMs < 1 || cacheMs > 5000 ||
      !Number.isSafeInteger(limitPerDay) || limitPerDay < 1 || limitPerDay > 1000) throw new Error('INVALID_ADMIN_CONFIGURATION');
  const postgres = store instanceof PostgresStore, sqlite = store instanceof Store && store.adminReadSource?.path;
  let cached, flight;
  return Object.freeze({ snapshot() {
    lifecycle.assertAccepting();
    if (flight) return flight.observation;
    if (cached && cached.expires > performance.now()) return Promise.resolve(cached.value);
    if (!postgres && !sqlite) return Promise.resolve(freezeAdminData(empty('ADMIN_SOURCE_UNSUPPORTED')));
    const current = { sources: empty(), cancel: null }; flight = current;
    const publish = (name, source) => {
      // Sources are produced only by fixed SQL/projectors in this module or its
      // owned worker. Cache just their bounded, redacted protocol output.
      if (!current.observed && names.includes(name)) current.sources[name] = source;
    };
    let observe, timer;
    current.observation = new Promise(resolve => { observe = resolve; });
    const settle = timedOut => {
      if (current.observed) return;
      current.observed = true; current.timedOut = timedOut; clearTimeout(timer);
      if (timedOut) for (const name of names) if (current.sources[name].status !== 'ready') current.sources[name] = unavailableSource(name, 'ADMIN_SOURCE_TIMEOUT');
      const value = freezeAdminData(structuredClone(current.sources));
      cached = { value, expires: performance.now() + cacheMs }; observe(value);
    };
    timer = setTimeout(() => { settle(true); current.cancel?.(); }, timeoutMs);
    const context = { days: utcDays(clock()), limitPerDay, publish, clock, workerFactory,
      registerCancel(cancel) { current.cancel = cancel; if (current.observed && current.timedOut) cancel(); } };
    const raw = lifecycle.trackWork(() => postgres ? readPostgres(store, context) : readSqlite(store, context));
    // Keep this flight and the real connection/worker tracked through rollback,
    // release and exit, even if the public observation already timed out.
    void raw.catch(() => {}).then(() => {
      settle(false);
      if (current.timedOut) cached = null;
      if (flight === current) flight = null;
    });
    return current.observation;
  } });
}
