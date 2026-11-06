import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const context = { window: {} };
vm.runInNewContext(readFileSync(new URL('../service/web/units.js', import.meta.url), 'utf8'), context);
const units = context.window.FlowwUnits;
const rejects = fn => assert.throws(fn, error => error.code === 'INVALID_AMOUNT' && error.message === 'INVALID_AMOUNT');

test('classic browser units exposes a frozen parse/format contract', () => {
  assert.equal(Object.isFrozen(units), true);
  assert.deepEqual(Object.keys(units).sort(), ['format', 'parse']);
});
test('human token amounts convert exactly to canonical atomic strings', () => {
  for (const [human, atomic] of [['0', '0'], ['0.000000', '0'], ['0.000001', '1'], ['0.001', '1000'],
    ['1', '1000000'], ['1.230000', '1230000'], ['9007199254.740993', '9007199254740993']]) {
    assert.equal(units.parse(human), atomic);
  }
  assert.equal(units.parse('1', 0), '1');
  assert.equal(units.parse('0.000000001', 9), '1');
  assert.equal(units.parse('0.000000000000000001', 18), '1');
});
test('format preserves exact large amounts and strips only insignificant fractional zeros', () => {
  for (const [atomic, human] of [['0', '0'], ['1', '0.000001'], ['1000', '0.001'], ['1000000', '1'],
    ['1230000', '1.23'], ['9007199254740993', '9007199254.740993']]) assert.equal(units.format(atomic), human);
  assert.equal(units.format('123', 0), '123');
  assert.equal(units.format('1', 18), '0.000000000000000001');
});
test('malformed, negative, exponent, whitespace and non-string human amounts fail closed', () => {
  for (const value of ['', ' ', ' 1', '1 ', '1\n', '\n1', '1\r\n', '01', '00.1', '.1', '1.', '+1', '-0', '-1',
    '1e3', '1E-6', '0x10', '1_000', '1,000', 'NaN', 'Infinity', '１２', '١', '1.2.3', 1, 1n, null, undefined, {}, []]) rejects(() => units.parse(value));
});
test('fractional precision is explicit and never rounds an amount', () => {
  rejects(() => units.parse('0.0000001'));
  rejects(() => units.parse('1.0000000'));
  rejects(() => units.parse('1.0', 0));
  rejects(() => units.parse('0.0000000000000000001', 18));
});
test('atomic inputs are canonical integer strings bounded to 38 digits', () => {
  const maximum = '9'.repeat(38);
  assert.equal(units.parse(maximum, 0), maximum);
  assert.equal(units.parse(units.format(maximum)), maximum);
  for (const value of ['', '00', '01', '1\n', '1 ', '-1', '+1', '1.0', '1e6', '9'.repeat(39), 1, 1n, null, {}]) rejects(() => units.format(value));
  rejects(() => units.parse('9'.repeat(33)));
  rejects(() => units.parse('1' + '0'.repeat(38), 0));
  rejects(() => units.parse('1'.repeat(10000)));
});
test('invalid decimal scales fail instead of coercing or performing unbounded exponentiation', () => {
  for (const decimals of [-1, 19, 1.5, NaN, Infinity, '6', null, {}, 1000000]) {
    rejects(() => units.parse('1', decimals)); rejects(() => units.format('1', decimals));
  }
});
test('round trips remain exact across supported asset precision and integer boundaries', () => {
  for (const decimals of [0, 1, 6, 9, 18]) {
    for (const amount of [0n, 1n, 9n, 10n, 999n, 1000n, (2n ** 53n) - 1n, (2n ** 53n) + 1n, (10n ** 38n) - 1n]) {
      const atomic = amount.toString(); assert.equal(units.parse(units.format(atomic, decimals), decimals), atomic);
    }
  }
});
