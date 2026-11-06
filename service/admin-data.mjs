import { createHash } from 'node:crypto';

// Every retained label is a service-owned literal. A provider or corrupted row
// cannot smuggle private text through a merely well-formed uppercase code.
export const ADMIN_EVENTS = Object.freeze(['TASK_CREATED', 'QUOTE_READY', 'APPROVED', 'POLICY_DENIED',
  'APPROVAL_REVOKED', 'EXECUTION_CLAIMED', 'PAYMENT_PREPARED', 'PAYMENT_OBSERVED',
  'PAYMENT_RECONCILED', 'RECOVERY_REQUIRED', 'OPERATION_STOPPED', 'REPORT_READY', 'REPORT_REJECTED', 'OTHER']);
export const ADMIN_REASONS = Object.freeze(['QUOTE_REQUIRED', 'APPROVAL_REQUIRED', 'APPROVED', 'APPROVAL_REVOKED',
  'SIGNING', 'PENDING', 'RESOURCE_DELIVERED', 'PAYMENT_CONFIRMED', 'CHAIN_CONFIRMED', 'REPORT_READY', 'REPORT_INVALID',
  'PROCESS_RESTART_RECONCILE', 'LEASE_EXPIRED_RECONCILE', 'OPERATION_LEASE_EXPIRED', 'PAYMENT_RECONCILIATION_REQUIRED',
  'TRANSACTION_FAILED', 'SETTLEMENT_UNCONFIRMED', 'RECONCILIATION_UNAVAILABLE', 'PAID_RESOURCE_UNAVAILABLE',
  'INVALID_PAID_RESOURCE', 'BUDGET_DENIED', 'UNAUTHORIZED_PAYMENT_TERMS', 'APPROVAL_EXPIRED', 'PAYER_CHANGED',
  'QUOTE_CHANGED', 'UNAPPROVED_PAYMENT_TERMS', 'DAILY_BUDGET_EXCEEDED', 'MANDATE_BUDGET_EXCEEDED',
  'MANDATE_EXPIRED', 'MANDATE_REVOKED', 'MANDATE_VERSION_CHANGED', 'REPORT_ADAPTER_UNAVAILABLE',
  'AI_PROCESS_FAILED', 'AI_TIMEOUT', 'AI_CANCELLED', 'AI_INVALID_OUTPUT', 'RPC_UNAVAILABLE',
  'FACILITATOR_UNAVAILABLE', 'SIGNING_DEADLINE_EXCEEDED', 'PAYMENT_BINDING_MISMATCH', 'INTEGRATION_UNAVAILABLE', 'OTHER']);
export const ADMIN_POLICY = Object.freeze(['PENDING', 'ALLOW', 'DENY', 'OTHER']);
export const ADMIN_PAYMENT = Object.freeze(['NOT_STARTED', 'SIGNING', 'PENDING', 'UNKNOWN', 'CONFIRMED', 'FAILED', 'OTHER']);
export const ADMIN_DELIVERY = Object.freeze(['NOT_STARTED', 'PENDING', 'COMPLETED', 'FAILED', 'OTHER']);
export const ADMIN_SCOPES = Object.freeze({
  tasks: 'current-persisted-task-states', events: 'newest-retained-task-events',
  usage: 'last-seven-utc-days-admitted-role-calls', executions: 'last-seven-utc-days-global-ledger-buckets',
});
const maximum = BigInt(Number.MAX_SAFE_INTEGER);
export function safeCount(value) {
  if (typeof value === 'string' && /^(0|[1-9][0-9]{0,15})$/.test(value)) value = BigInt(value);
  if (typeof value === 'bigint') {
    if (value < 0n || value > maximum) throw new Error('ADMIN_INVALID_DATA');
    return Number(value);
  }
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('ADMIN_INVALID_DATA');
  return value;
}
const plus = (a, b) => safeCount(BigInt(a) + BigInt(b));
export function safeTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error('ADMIN_INVALID_DATA');
  return value;
}
export function freezeAdminData(value) {
  if (value && typeof value === 'object') { for (const item of Object.values(value)) freezeAdminData(item); Object.freeze(value); }
  return value;
}
export const unavailableSource = (name, code = 'ADMIN_SOURCE_UNAVAILABLE') => ({
  status: 'unavailable', capturedAt: null, scope: ADMIN_SCOPES[name], code,
});
export const readySource = (name, data, capturedAt) => ({ status: 'ready', capturedAt: safeTime(capturedAt), scope: ADMIN_SCOPES[name], data });
export function utcDays(now) {
  const day = Math.floor(now / 86_400_000) * 86_400_000;
  return Array.from({ length: 7 }, (_, i) => new Date(day - (6 - i) * 86_400_000).toISOString().slice(0, 10));
}
const partition = keys => Object.fromEntries(keys.map(key => [key, 0]));
const flag = value => value === true || value === 1 || value === 1n ? true : value === false || value === 0 || value === 0n ? false : (() => { throw new Error('ADMIN_INVALID_DATA'); })();
function label(value, labels) { if (!labels.includes(value)) throw new Error('ADMIN_INVALID_DATA'); return value; }
export function projectTasks(rows) {
  if (!Array.isArray(rows) || rows.length > 1120) throw new Error('ADMIN_INVALID_DATA');
  const data = { total: 0, active: 0, archived: 0, reportAvailable: 0, recoveryRequired: 0,
    attention: { unresolvedPayments: 0, confirmedUndelivered: 0, deliveredWithoutReport: 0 },
    policy: partition(ADMIN_POLICY), payment: partition(ADMIN_PAYMENT), delivery: partition(ADMIN_DELIVERY),
    coverage: { archivedIncluded: true, invalidStateTasks: 0, invalidReportShapes: 0 } };
  for (const row of rows) {
    const n = safeCount(row.n), archived = flag(row.archived), available = flag(row.report_available), invalidReport = flag(row.invalid_report);
    const policy = label(row.policy, ADMIN_POLICY), payment = label(row.payment, ADMIN_PAYMENT), delivery = label(row.delivery, ADMIN_DELIVERY);
    if (available && invalidReport) throw new Error('ADMIN_INVALID_DATA');
    data.total = plus(data.total, n); const membership = archived ? 'archived' : 'active';
    data[membership] = plus(data[membership], n);
    for (const [kind, value] of Object.entries({ policy, payment, delivery })) data[kind][value] = plus(data[kind][value], n);
    if (available) data.reportAvailable = plus(data.reportAvailable, n);
    if ([policy, payment, delivery].includes('OTHER')) data.coverage.invalidStateTasks = plus(data.coverage.invalidStateTasks, n);
    if (invalidReport) data.coverage.invalidReportShapes = plus(data.coverage.invalidReportShapes, n);
    const attention = ['SIGNING', 'PENDING', 'UNKNOWN'].includes(payment) ? 'unresolvedPayments'
      : payment === 'CONFIRMED' ? delivery !== 'COMPLETED' ? 'confirmedUndelivered' : !available ? 'deliveredWithoutReport' : null : null;
    if (attention) { data.attention[attention] = plus(data.attention[attention], n); data.recoveryRequired = plus(data.recoveryRequired, n); }
  }
  return data;
}
export function projectEvents(rows) {
  if (!Array.isArray(rows) || rows.length > 51) throw new Error('ADMIN_INVALID_DATA');
  return rows.map(row => ({ at: safeTime(row.at),
    taskRef: typeof row.task_id === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(row.task_id)
      ? 'task_' + createHash('sha256').update(row.task_id).digest('hex').slice(0, 12) : null,
    event: label(row.event, ADMIN_EVENTS), reason: label(row.reason, ADMIN_REASONS),
    policy: label(row.policy, ADMIN_POLICY), payment: label(row.payment, ADMIN_PAYMENT), delivery: label(row.delivery, ADMIN_DELIVERY),
  }));
}
export function projectUsage(rows, days, limitPerDay) {
  const values = new Map();
  if (!Array.isArray(rows) || rows.length > 7) throw new Error('ADMIN_INVALID_DATA');
  for (const row of rows) {
    const day = typeof row.bucket === 'string' ? row.bucket.replace(/:global$/, '') : null;
    if (!days.includes(day) || row.bucket !== day + ':global' || values.has(day)) throw new Error('ADMIN_INVALID_DATA');
    values.set(day, safeCount(row.used));
  }
  return { days: days.map(day => ({ day, admittedRoleCalls: values.get(day) ?? 0 })), limitPerDay: safeCount(limitPerDay) };
}
export function projectExecutions(rows, days) {
  const values = new Map();
  if (!Array.isArray(rows) || rows.length > 7) throw new Error('ADMIN_INVALID_DATA');
  for (const row of rows) {
    if (!days.includes(row.day) || values.has(row.day) || safeCount(row.invalid) !== 0) throw new Error('ADMIN_INVALID_DATA');
    values.set(row.day, { heldExecutions: safeCount(row.held), observedExecutions: safeCount(row.spent) });
  }
  return { days: days.map(day => ({ day, ...(values.get(day) ?? { heldExecutions: 0, observedExecutions: 0 }) })), coverage: 'global ledger buckets' };
}
const literals = values => values.map(value => "'" + value + "'").join(',');
export function adminQueries(dialect, days) {
  if (!['sqlite', 'postgres'].includes(dialect) || days.length !== 7) throw new Error('ADMIN_INVALID_DATA');
  const pg = dialect === 'postgres', schema = pg ? 'floww_runtime' : 'main';
  const field = key => pg ? `t.data->>'${key}'` : `json_extract(t.data,'$.${key}')`;
  const type = pg ? "jsonb_typeof(t.data#>'{result,answer}')" : "json_type(t.data,'$.result.answer')";
  const normalize = (value, values) => `CASE WHEN ${value} IN (${literals(values.slice(0, -1))}) THEN ${value} ELSE 'OTHER' END`;
  const states = ['policy', 'payment', 'delivery'].map((kind, i) => `${normalize(field(kind), [ADMIN_POLICY, ADMIN_PAYMENT, ADMIN_DELIVERY][i])} AS ${kind}`).join(',');
  const eventField = key => pg ? `e.value->>'${key}'` : `json_extract(e.value,'$.${key}')`;
  const eventsFrom = pg ? `CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(t.data->'events')='array' THEN t.data->'events' ELSE '[]'::jsonb END) e(value)`
    : `JOIN json_each(CASE WHEN json_type(t.data,'$.events')='array' THEN json_extract(t.data,'$.events') ELSE '[]' END) e ON 1=1`;
  const params = days.map((_, i) => pg ? '$' + (i + 1) : '?');
  const counter = key => pg ? `(data::jsonb->>'${key}')` : `json_extract(data,'$.${key}')`;
  const validCounter = key => pg ? `(jsonb_typeof(data::jsonb->'${key}')='number' AND ${counter(key)} ~ '^(0|[1-9][0-9]*)$' AND (${counter(key)})::numeric<=9007199254740991)`
    : `(json_type(data,'$.${key}')='integer' AND ${counter(key)}>=0 AND ${counter(key)}<=9007199254740991)`;
  const valid = `(${validCounter('executionsHeld')} AND ${validCounter('executionsSpent')})`;
  const sum = key => `SUM(CASE WHEN ${valid} THEN ${pg ? `(${counter(key)})::numeric` : counter(key)} ELSE 0 END)`;
  return {
    tasks: { text: `SELECT archived,policy,payment,delivery,report_available,invalid_report,count(*) AS n FROM
      (SELECT t.archived,${states},CASE WHEN ${type} IN ('object','array') THEN 1 ELSE 0 END AS report_available,
      CASE WHEN ${type} IS NOT NULL AND ${type} NOT IN ('null','object','array') THEN 1 ELSE 0 END AS invalid_report
      FROM ${schema}.tasks t) classified GROUP BY archived,policy,payment,delivery,report_available,invalid_report`, values: [] },
    events: { text: `SELECT CASE WHEN length(t.id)<=36 THEN t.id ELSE NULL END AS task_id,
      substr(${eventField('at')},1,64) AS at,${normalize(eventField('type'), ADMIN_EVENTS)} AS event,
      ${normalize(eventField('code'), ADMIN_REASONS)} AS reason,${states}
      FROM ${schema}.tasks t ${eventsFrom} ORDER BY at DESC,task_id DESC LIMIT 51`, values: [] },
    usage: { text: `SELECT bucket,used FROM ${schema}.workspace_model_usage WHERE bucket IN (${params.join(',')})`, values: days.map(day => day + ':global') },
    // owner,day is a real existing index on both engines. Global buckets alone
    // avoid double-counting their corresponding per-owner reservation rows.
    executions: { text: `SELECT day,${sum('executionsHeld')} AS held,${sum('executionsSpent')} AS spent,
      SUM(CASE WHEN ${valid} THEN 0 ELSE 1 END) AS invalid FROM ${schema}.workspace_budget_buckets
      WHERE owner='*' AND day IN (${params.join(',')}) GROUP BY day`, values: days },
  };
}
export function projectAdminSource(name, rows, days, limitPerDay) {
  return name === 'tasks' ? projectTasks(rows) : name === 'events' ? projectEvents(rows)
    : name === 'usage' ? projectUsage(rows, days, limitPerDay) : projectExecutions(rows, days);
}
