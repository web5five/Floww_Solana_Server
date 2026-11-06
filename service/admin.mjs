import { adminWallets, fail } from './config.mjs';
import { createAdminReader } from './admin-reader.mjs';
import { safeCount, safeTime } from './admin-data.mjs';
import { TELEMETRY_METHODS, TELEMETRY_ROUTES } from './observability.mjs';

const label = (value, allowed) => { if (!allowed.includes(value)) throw new Error('ADMIN_INVALID_DATA'); return value; };
const boolean = value => { if (typeof value !== 'boolean') throw new Error('ADMIN_INVALID_DATA'); return value; };
function telemetryView(telemetry) {
  const input = telemetry?.operatorSnapshot();
  if (!input || !Array.isArray(input.counts) || input.counts.length > TELEMETRY_METHODS.length * TELEMETRY_ROUTES.length * 6 ||
      !Array.isArray(input.latencyBuckets) || input.latencyBuckets.length !== 11 ||
      !Array.isArray(input.minuteBuckets) || input.minuteBuckets.length > 60 ||
      !Array.isArray(input.requests) || input.requests.length > 200) throw new Error('ADMIN_INVALID_DATA');
  const counters = Object.fromEntries(['completed', 'incomplete', 'suppressed', 'unmeasuredLatency', 'unmeasuredTime', 'clockRegressions']
    .map(key => [key, safeCount(input[key])]));
  const counts = input.counts.map(row => ({ method: label(row.method, TELEMETRY_METHODS), route: label(row.route, TELEMETRY_ROUTES),
    statusClass: label(row.statusClass, ['1xx', '2xx', '3xx', '4xx', '5xx', 'incomplete']), count: safeCount(row.count) }));
  const limits = [10, 50, 100, 250, 500, 1000, 2500, 5000, 15000, 60000, null];
  const latencyBuckets = input.latencyBuckets.map((row, i) => {
    if (row.upperMs !== limits[i]) throw new Error('ADMIN_INVALID_DATA');
    return { upperMs: row.upperMs, count: safeCount(row.count) };
  });
  const minuteBuckets = input.minuteBuckets.map(row => ({ minute: safeTime(row.minute), completed: safeCount(row.completed), incomplete: safeCount(row.incomplete) }));
  const startedAt = safeTime(input.startedAt), minuteWindowFrom = safeTime(input.minuteWindowFrom), minuteWindowThrough = safeTime(input.minuteWindowThrough);
  if (startedAt > minuteWindowFrom || minuteWindowFrom > minuteWindowThrough || minuteBuckets.length < 1) throw new Error('ADMIN_INVALID_DATA');
  const requests = input.requests.map(row => {
    if ((row.requestId !== null && (typeof row.requestId !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(row.requestId))) ||
        (row.status !== null && (!Number.isInteger(row.status) || row.status < 100 || row.status > 599)) ||
        (row.durationMs !== null && (!Number.isSafeInteger(row.durationMs) || row.durationMs < 0 || row.durationMs > 86_400_000)) ||
        (row.outcome === 'incomplete' ? row.status !== null : row.status === null)) throw new Error('ADMIN_INVALID_DATA');
    return { at: row.at === null ? null : safeTime(row.at), requestId: row.requestId,
      method: label(row.method, TELEMETRY_METHODS), route: label(row.route, TELEMETRY_ROUTES), status: row.status,
      outcome: label(row.outcome, ['completed', 'incomplete']), durationMs: row.durationMs };
  });
  const countersCapped = [...Object.values(counters), ...counts.map(row => row.count), ...latencyBuckets.map(row => row.count),
    ...minuteBuckets.flatMap(row => [row.completed, row.incomplete]), safeCount(input.retainedAway)].some(value => value === Number.MAX_SAFE_INTEGER);
  return { runtime: { startedAt, ...counters, countersCapped, counts, latencyBuckets, minuteWindowFrom, minuteWindowThrough, minuteBuckets },
    requests, retainedAway: safeCount(input.retainedAway) };
}
const unavailable = (scope, code = 'ADMIN_SOURCE_UNAVAILABLE') => ({ status: 'unavailable', capturedAt: null, scope, code });
function queryLimit(query, max) {
  if (Object.keys(query).some(key => key !== 'limit') || (query.limit !== undefined &&
      (typeof query.limit !== 'string' || !/^[1-9][0-9]{0,2}$/.test(query.limit) || Number(query.limit) > max))) fail('INVALID_ADMIN_QUERY');
  return query.limit === undefined ? 25 : Number(query.limit);
}
const emptyQuery = query => { if (Object.keys(query).length !== 0) fail('INVALID_ADMIN_QUERY'); };

export function mountAdmin(routes, { config, store, auth, lifecycle, adapterStatus, telemetry, reader: suppliedReader }) {
  // Normal wallet sign-in never grants a role. This server-only, defensive copy
  // starts empty and cannot be mutated through a frozen Set's methods.
  const members = adminWallets(config.adminWallets ?? []);
  const reader = suppliedReader ?? createAdminReader({ store, lifecycle, clock: () => store.clock(), limitPerDay: config.globalModelDailyLimit ?? 60 });
  async function requireAdmin(req) {
    const session = await auth(req);
    if (!members.includes(session.wallet)) fail('ADMIN_ACCESS_DENIED', 403);
    lifecycle.assertAccepting();
    return session;
  }
  async function release(req, res, session, dto) {
    const current = await requireAdmin(req);
    if (current.wallet !== session.wallet) fail('AUTHENTICATION_REQUIRED', 401);
    lifecycle.assertAccepting(); res.json(dto);
  }
  routes.get('/api/admin/access', async (req, res) => {
    const session = await requireAdmin(req); emptyQuery(req.query);
    await release(req, res, session, { role: 'ADMIN_READ', expiresAt: new Date(session.expires).toISOString() });
  });
  routes.get('/api/admin/overview', async (req, res) => {
    const session = await requireAdmin(req); emptyQuery(req.query);
    const database = await reader.snapshot();
    let runtime;
    try {
      const view = telemetryView(telemetry);
      runtime = { status: 'ready', capturedAt: view.runtime.minuteWindowThrough, scope: 'current-process', data: {
        ...view.runtime, capabilities: { workspaceAdapterReady: boolean(adapterStatus.workspaceAdapterReady),
          reportAdapterReady: boolean(adapterStatus.reportAdapterReady), modelConfigured: Boolean(config.model && config.apiKey),
          paymentEnabled: config.paymentEnabled === true }, draining: lifecycle.draining === true,
      } };
    } catch { runtime = unavailable('current-process'); }
    await release(req, res, session, { version: 'admin-read/v1', generatedAt: new Date(store.clock()).toISOString(),
      sources: { runtime, tasks: database.tasks, usage: database.usage, executions: database.executions } });
  });
  routes.get('/api/admin/events', async (req, res) => {
    const session = await requireAdmin(req), limit = queryLimit(req.query, 50), source = (await reader.snapshot()).events;
    const dto = source.status === 'ready' ? { ...source, data: { events: source.data.slice(0, limit), hasMore: source.data.length > limit,
      retention: 'up to 100 retained events per Task', stateScope: 'current-task-state', taskCapturedAt: source.capturedAt,
    } } : source;
    await release(req, res, session, dto);
  });
  routes.get('/api/admin/requests', async (req, res) => {
    const session = await requireAdmin(req), limit = queryLimit(req.query, 100);
    let source;
    try {
      const view = telemetryView(telemetry);
      source = { status: 'ready', capturedAt: view.runtime.minuteWindowThrough, scope: 'current-process', data: {
        requests: view.requests.slice(0, limit), hasMore: view.requests.length > limit,
        retention: 'latest 200 this-process observations', retained: view.requests.length,
        truncated: view.retainedAway > 0, dropped: view.retainedAway,
        unmeasuredTime: view.runtime.unmeasuredTime,
      } };
    } catch { source = unavailable('current-process'); }
    await release(req, res, session, source);
  });
  return Object.freeze({});
}
