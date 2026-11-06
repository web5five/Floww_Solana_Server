import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, adminWallets } from '../service/config.mjs';
import { generateKeyPairSync } from 'node:crypto';
import { getBase58Decoder } from '@solana/kit';
import { projectTasks, projectEvents, projectUsage, projectExecutions, safeCount, adminQueries, utcDays } from '../service/admin-data.mjs';

const wallet = () => getBase58Decoder().decode(generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).subarray(-32));
const row = (change = {}) => ({ archived: 0n, policy: 'PENDING', payment: 'NOT_STARTED', delivery: 'NOT_STARTED', report_available: 0n, invalid_report: 0n, n: 1n, ...change });
test('admin membership is empty by default, exact, bounded and deeply immutable', () => {
  const a = wallet(), b = wallet();
  assert.deepEqual(loadConfig({}).adminWallets, []);
  const config = loadConfig({ FLOWW_ADMIN_WALLETS: a + ', ' + b });
  assert.deepEqual(config.adminWallets, [a, b]); assert.ok(Object.isFrozen(config.adminWallets));
  assert.throws(() => config.adminWallets.push(wallet()), TypeError);
  assert.throws(() => adminWallets(new Array(1)), { code: 'INVALID_CONFIGURATION' });
  for (const value of [a + ',' + a, a + ',', 'not-a-wallet', Array.from({ length: 6 }, wallet).join(','), true]) {
    assert.throws(() => loadConfig({ FLOWW_ADMIN_WALLETS: value }), { code: 'INVALID_CONFIGURATION' });
  }
});
test('all counts reject negative, fractional, unsafe and coerced values', () => {
  for (const value of [-1, 1.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, -1n, '9007199254740992', '01', '1.0', null, true]) assert.throws(() => safeCount(value));
  assert.equal(safeCount('9007199254740991'), Number.MAX_SAFE_INTEGER);
  assert.equal(safeCount(1n), 1);
  assert.throws(() => projectTasks([row({ n: Number.MAX_SAFE_INTEGER }), row()]));
  assert.throws(() => projectTasks([row({ archived: 2n })]));
  assert.throws(() => projectTasks([row({ report_available: 1, invalid_report: 1 })]));
});
test('joint states partition recovery and include archived records without inventing reports', () => {
  const data = projectTasks([row(), row({ payment: 'SIGNING' }), row({ payment: 'PENDING' }), row({ payment: 'UNKNOWN' }),
    row({ archived: 1n, payment: 'CONFIRMED', delivery: 'FAILED' }), row({ payment: 'CONFIRMED', delivery: 'COMPLETED', invalid_report: 1n }),
    row({ payment: 'CONFIRMED', delivery: 'COMPLETED', report_available: 1n }), row({ policy: 'OTHER', payment: 'OTHER', delivery: 'OTHER' })]);
  assert.equal(data.total, 8); assert.equal(data.active, 7); assert.equal(data.archived, 1);
  assert.equal(data.reportAvailable, 1); assert.equal(data.recoveryRequired, 5);
  assert.deepEqual(data.attention, { unresolvedPayments: 3, confirmedUndelivered: 1, deliveredWithoutReport: 1 });
  assert.deepEqual(data.coverage, { archivedIncluded: true, invalidStateTasks: 1, invalidReportShapes: 1 });
  assert.equal(Object.values(data.payment).reduce((a, b) => a + b), data.total);
});
test('usage and executions are admissions/reservations with strict count validity', () => {
  const days = utcDays(Date.UTC(2026, 10, 7));
  assert.equal(projectUsage([{ bucket: days[6] + ':global', used: '5' }], days, 60).days[6].admittedRoleCalls, 5);
  assert.throws(() => projectUsage([{ bucket: days[6] + ':owner:private', used: 5 }], days, 60));
  assert.throws(() => projectExecutions([{ day: days[6], held: 0, spent: 0, invalid: 1 }], days));
  assert.throws(() => projectExecutions([{ day: days[6], held: -1, spent: 0, invalid: 0 }], days));
  assert.deepEqual(projectExecutions([{ day: days[6], held: '2', spent: '3', invalid: '0' }], days).days[6], { day: days[6], heldExecutions: 2, observedExecutions: 3 });
});
test('events retain only fixed labels, opaque Task correlation and canonical timestamps', () => {
  const data = projectEvents([{ task_id: '12345678-1234-1234-1234-123456789abc', at: '2026-11-07T00:00:00.000Z',
    event: 'OTHER', reason: 'OTHER', policy: 'ALLOW', payment: 'CONFIRMED', delivery: 'COMPLETED', owner: 'private', proof: 'private' }]);
  assert.match(data[0].taskRef, /^task_[a-f0-9]{12}$/); assert.doesNotMatch(JSON.stringify(data), /12345678|private|proof|owner/);
  assert.throws(() => projectEvents([{ ...data[0], at: 'private', task_id: 'private' }]));
  assert.throws(() => projectEvents([{ ...data[0], at: '2026-11-07T00:00:00.000Z', event: 'PRIVATE_WALLET', task_id: 'private' }]));
  for (const dialect of ['sqlite', 'postgres']) {
    const query = adminQueries(dialect, utcDays(Date.now()));
    assert.match(query.events.text, /ELSE 'OTHER'/); assert.match(query.executions.text, /WHERE owner='\*' AND day IN/);
    assert.doesNotMatch(Object.values(query).map(value => value.text).join(''), /SELECT \*|UPDATE |INSERT |DELETE |FOR UPDATE|purpose|signedData|quoteData|deliveredBody/);
  }
});
