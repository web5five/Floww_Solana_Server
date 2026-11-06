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
  ...['access', 'overview', 'events', 'requests'].map(action => ['/api/admin/' + action, 'admin_' + action]),
  ['/api/voice/capabilities', 'voice_capabilities'], ['/api/voice/transcriptions', 'voice_transcription'],
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

export const TELEMETRY_ROUTES = Object.freeze([...new Set([...routes.values(), 'unclassified'])]);
export const TELEMETRY_METHODS = Object.freeze([...methods, 'OTHER']);
export function createRequestTelemetry({ write = defaultWrite, clock = () => performance.now(), wallClock = Date.now, maxLogsPerMinute = 600 } = {}) {
  if (typeof write !== 'function' || typeof clock !== 'function' || typeof wallClock !== 'function' || !Number.isInteger(maxLogsPerMinute) ||
      maxLogsPerMinute < 0 || maxLogsPerMinute > 10_000) throw new Error('INVALID_TELEMETRY_CONFIGURATION');
  const seen = new WeakSet(), counts = new Map(), latency = buckets.map(() => 0);
  let completed = 0, incomplete = 0, suppressed = 0, unmeasuredLatency = 0, windowStart = 0, written = 0;
  const recent = [], minutes = new Map();
  let unmeasuredTime = 0, clockRegressions = 0, retainedAway = 0;
  const epoch = () => {
    try { const value = wallClock(); return Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000 ? value : null; }
    catch { return null; }
  };
  const startedEpoch = epoch(); let lastEpoch = startedEpoch;
  const wallTime = () => {
    const value = epoch();
    if (value !== null && lastEpoch !== null && value < lastEpoch) { clockRegressions = add(clockRegressions); return null; }
    if (value !== null) lastEpoch = value;
    return value;
  };
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
      const at = wallTime();
      if (at === null) unmeasuredTime = add(unmeasuredTime);
      else {
        const minute = Math.floor(at / 60_000) * 60_000;
        const current = minutes.get(minute) ?? { completed: 0, incomplete: 0 };
        current[outcome] = add(current[outcome]); minutes.set(minute, current);
        for (const key of minutes.keys()) if (key < minute - 59 * 60_000) minutes.delete(key);
      }
      recent.push({ at: at === null ? null : new Date(at).toISOString(), requestId: id, method, route, status, outcome, durationMs });
      if (recent.length > 200) { recent.shift(); retainedAway = add(retainedAway); }
    };
    res.once('finish', () => finish(true));
    res.once('close', () => finish(res.writableFinished === true));
  }
  return Object.freeze({ observeRequest,
    snapshot: () => ({ completed, incomplete, suppressed, unmeasuredLatency, counts: Object.fromEntries(counts),
      latencyBuckets: buckets.map((upperMs, index) => ({ upperMs, count: latency[index] })) }),
    operatorSnapshot() {
      const at = wallTime();
      if (startedEpoch === null || at === null || at < startedEpoch) throw new Error('ADMIN_CLOCK_UNAVAILABLE');
      const minute = Math.floor(at / 60_000) * 60_000;
      const first = Math.max(Math.floor(startedEpoch / 60_000) * 60_000, minute - 59 * 60_000);
      for (const key of minutes.keys()) if (key < first) minutes.delete(key);
      return { startedAt: new Date(startedEpoch).toISOString(), completed, incomplete, suppressed, unmeasuredLatency,
        unmeasuredTime, clockRegressions,
        counts: [...counts].map(([key, count]) => { const [method, route, statusClass] = key.split(':'); return { method, route, statusClass, count }; }),
        latencyBuckets: buckets.map((upperMs, index) => ({ upperMs, count: latency[index] })),
        minuteWindowFrom: new Date(Math.max(startedEpoch, first)).toISOString(), minuteWindowThrough: new Date(at).toISOString(),
        minuteBuckets: Array.from({ length: (minute - first) / 60_000 + 1 }, (_, i) => {
          const key = first + i * 60_000; return { minute: new Date(key).toISOString(), ...(minutes.get(key) ?? { completed: 0, incomplete: 0 }) };
        }),
        requests: recent.slice().reverse().map(record => ({ ...record })), retainedAway,
      };
    },
  });
}
