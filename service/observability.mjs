// Fixed labels only: URLs, owners, payloads, credentials and proofs never enter telemetry.
const routes = new Map([
  ['/livez', 'liveness'], ['/readyz', 'readiness'], ['/api/health', 'capabilities'],
  ['/api/session', 'session'], ['/api/auth/challenge', 'login_challenge'],
  ['/api/auth/verify', 'login_verify'], ['/api/auth/logout', 'logout'],
  ['/api/tasks', 'tasks'], ['/api/tasks/:id', 'task_detail'],
  ...['archive', 'restore', 'quote', 'approve', 'revoke', 'execute', 'reconcile', 'recover']
    .map(action => ['/api/tasks/:id/' + action, 'task_' + action]),
  ['/api/catalog', 'catalog'], ['/api/dashboard', 'dashboard'], ['/api/activity', 'activity'],
  ['/api/conversations', 'conversations'], ['/api/conversations/:id', 'conversation_detail'],
  ...['messages', 'plan', 'confirm'].map(action => ['/api/conversations/:id/' + action, 'conversation_' + action]),
  ['/api/memories', 'memories'], ['/api/memories/:id', 'memory_detail'],
  ['/api/mandates', 'mandates'], ['/api/mandates/:id/revoke', 'mandate_revoke'],
  ['/merchant/reports/:resourceId', 'merchant_report'],
]);
const methods = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const buckets = [10, 50, 100, 250, 500, 1000, 2500, 5000, 15000, 60000, null];
const add = value => Math.min(Number.MAX_SAFE_INTEGER, value + 1);
const requestId = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value) ? value : null;
const defaultWrite = line => {
  if (process.stdout.writableLength > 65_536 || process.stdout.destroyed) return false;
  return process.stdout.write(line);
};

export function createRequestTelemetry({ write = defaultWrite, clock = () => performance.now(), maxLogsPerMinute = 600 } = {}) {
  if (typeof write !== 'function' || typeof clock !== 'function' || !Number.isInteger(maxLogsPerMinute) ||
      maxLogsPerMinute < 0 || maxLogsPerMinute > 10_000) throw new Error('INVALID_TELEMETRY_CONFIGURATION');
  const seen = new WeakSet(), counts = new Map(), latency = buckets.map(() => 0);
  let completed = 0, incomplete = 0, suppressed = 0, unmeasuredLatency = 0, windowStart = 0, written = 0;
  const time = () => {
    try { const value = clock(); return Number.isFinite(value) && value >= 0 ? value : null; }
    catch { return null; }
  };
  function emit(record) {
    const at = time();
    if (at !== null && (at - windowStart >= 60_000 || at < windowStart)) { windowStart = at; written = 0; }
    if (written >= maxLogsPerMinute) { suppressed = add(suppressed); return; }
    written++;
    try {
      const accepted = write(JSON.stringify(record) + '\n');
      if (accepted && typeof accepted.then === 'function') {
        Promise.resolve(accepted).catch(() => {}); suppressed = add(suppressed);
      } else if (accepted === false) suppressed = add(suppressed);
    } catch { suppressed = add(suppressed); }
  }
  function observeRequest(req, res) {
    if (seen.has(res)) return;
    seen.add(res);
    const started = time(), id = requestId(req.requestId), method = methods.has(req.method) ? req.method : 'OTHER';
    let recorded = false;
    const finish = delivered => {
      if (recorded) return;
      recorded = true;
      const route = routes.get(req.route?.path) ?? 'unclassified';
      const intact = delivered && res.destroyed !== true && res.socket?.destroyed !== true;
      const status = intact && Number.isInteger(res.statusCode) && res.statusCode >= 100 && res.statusCode <= 599 ? res.statusCode : null;
      const ended = time();
      const durationMs = started === null || ended === null || ended < started ? null
        : Math.min(86_400_000, Math.round(ended - started));
      const outcome = status === null ? 'incomplete' : 'completed';
      if (outcome === 'completed') completed = add(completed); else incomplete = add(incomplete);
      const key = method + ':' + route + ':' + (status === null ? 'incomplete' : Math.floor(status / 100) + 'xx');
      counts.set(key, add(counts.get(key) ?? 0));
      if (durationMs === null) unmeasuredLatency = add(unmeasuredLatency);
      else {
        const bucket = buckets.findIndex(limit => limit === null || durationMs <= limit);
        latency[bucket] = add(latency[bucket]);
      }
      emit({ event: 'http_request', requestId: id, method, route, status, outcome, durationMs });
    };
    res.once('finish', () => finish(true));
    res.once('close', () => finish(res.writableFinished === true));
  }
  return Object.freeze({ observeRequest,
    snapshot: () => ({ completed, incomplete, suppressed, unmeasuredLatency, counts: Object.fromEntries(counts),
      latencyBuckets: buckets.map((upperMs, index) => ({ upperMs, count: latency[index] })) }),
  });
}
