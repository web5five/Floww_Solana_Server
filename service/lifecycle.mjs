import { ServiceError } from './config.mjs';

const integer = (value, maximum) => Number.isInteger(value) && value > 0 && value <= maximum;
const snapshot = (databaseReady, ledgerReady, reasonCode) => Object.freeze({
  ready: databaseReady && ledgerReady, databaseReady, ledgerReady, reasonCode,
});
const unavailable = () => snapshot(false, false, 'READINESS_UNAVAILABLE');
const drainingState = () => snapshot(false, false, 'DRAINING');

/** Process-local admission/drain state. It never changes a financial record. */
export function createLifecycle({ probe, probeTimeoutMs = 2500, probeCacheMs = 1000, clock = Date.now } = {}) {
  if (typeof probe !== 'function' || typeof clock !== 'function' ||
      !integer(probeTimeoutMs, 30_000) || !integer(probeCacheMs, 30_000)) {
    throw new ServiceError('INVALID_LIFECYCLE_CONFIGURATION', 500);
  }
  let draining = false, requests = 0, work = 0, cached = null, flight = null;
  const idleWaiters = new Set();
  const notify = () => {
    if (requests || work) return;
    for (const resolve of idleWaiters) resolve();
    idleWaiters.clear();
  };
  async function trackWork(action) {
    work++;
    try { return await action(); }
    finally { work--; notify(); }
  }
  const normalize = value => {
    const databaseReady = value?.databaseReady === true, ledgerReady = value?.ledgerReady === true;
    const code = !databaseReady ? 'DATABASE_CONNECTION' : !ledgerReady
      ? value?.reasonCode === 'LEDGER_IMPORT_REQUIRED' ? 'LEDGER_IMPORT_REQUIRED' : 'BUDGET_STATE_UNAVAILABLE'
      : 'READY';
    return snapshot(databaseReady, ledgerReady, code);
  };
  function readiness({ fresh = false } = {}) {
    if (draining) return Promise.resolve(drainingState());
    if (flight) return flight.observation.then(value => draining ? drainingState() : value);
    if (!fresh && cached && cached.expiresAt > clock()) return Promise.resolve(cached.value);
    const current = {}; flight = current;
    // Timing out the HTTP observation cannot cancel the underlying DB query.
    // Retain its store until the actual probe has finished using it.
    const raw = trackWork(() => Promise.resolve().then(probe)).then(normalize, unavailable);
    current.observation = new Promise(resolve => {
      let completed = false, timedOut = false;
      const timer = setTimeout(() => {
        completed = true; timedOut = true;
        const value = snapshot(false, false, 'READINESS_TIMEOUT');
        cached = { value, expiresAt: clock() + probeCacheMs }; resolve(value);
      }, probeTimeoutMs);
      raw.then(value => {
        if (!completed) {
          completed = true; clearTimeout(timer);
          cached = { value, expiresAt: clock() + probeCacheMs }; resolve(value);
        }
        // A timed-out query stays single-flight until it actually settles.
        // Repeated probes must not build an unbounded database wait queue.
        if (timedOut) cached = null;
        if (flight === current) flight = null;
      });
    });
    return current.observation.then(value => draining ? drainingState() : value);
  }
  return Object.freeze({
    get draining() { return draining; },
    readiness,
    beginDrain() { draining = true; cached = null; },
    assertAccepting() {
      if (draining) { const error = new ServiceError('SERVICE_DRAINING', 503); error.retryAfter = 1; throw error; }
    },
    trackRequest(req, res) {
      requests++;
      let done = false;
      const finish = () => {
        if (done) return; done = true; requests--;
        res.removeListener('finish', finish); res.removeListener('close', finish); notify();
      };
      res.once('finish', finish); res.once('close', finish);
    },
    trackWork,
    whenIdle() { return requests || work ? new Promise(resolve => idleWaiters.add(resolve)) : Promise.resolve(); },
    counts() { return { requests, work }; },
  });
}

async function bounded(promise, milliseconds) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve(promise).then(value => ({ settled: true, value }), () => ({ settled: true, value: false })),
      new Promise(resolve => { timer = setTimeout(() => resolve({ settled: false }), milliseconds); }),
    ]);
  } finally { clearTimeout(timer); }
}

/** Stop HTTP admission; let signed-payment bookkeeping retain its database. */
export function createShutdown({ server, store, lifecycle, graceMs = 15_000, storeCloseMs = 3000 }) {
  if (!integer(graceMs, 120_000) || !integer(storeCloseMs, 30_000)) {
    throw new ServiceError('INVALID_LIFECYCLE_CONFIGURATION', 500);
  }
  let closing, closingStore;
  const closeStore = () => closingStore ??= Promise.resolve().then(() => store.close()).then(() => true, () => false);
  return function close() {
    if (closing) return closing;
    lifecycle.beginDrain();
    closing = (async () => {
      const stopped = new Promise(resolve => server.close(error => resolve(!error || error.code === 'ERR_SERVER_NOT_RUNNING')));
      server.closeIdleConnections?.();
      const idle = lifecycle.whenIdle();
      // A response that was active at server.close() can become idle later.
      // Reap that keep-alive connection after its handler has completed too.
      void idle.then(() => server.closeIdleConnections?.());
      const drained = await bounded(Promise.all([stopped, idle]), graceMs);
      if (!drained.settled) {
        // Closing HTTP cannot cancel settlement or its durable observations.
        // Close the database only after those handlers finish, even when the
        // HTTP drain deadline has already been reported as incomplete.
        server.closeAllConnections?.();
        void lifecycle.whenIdle().then(closeStore);
        return Object.freeze({ drained: false, storeClosed: false, forcedHttpClose: true });
      }
      const database = await bounded(closeStore(), storeCloseMs);
      return Object.freeze({ drained: drained.value[0] === true, storeClosed: database.settled && database.value === true, forcedHttpClose: false });
    })();
    return closing;
  };
}
