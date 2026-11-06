(() => {
  'use strict';
  const invalid = () => { const error = new Error('INVALID_AMOUNT'); error.code = 'INVALID_AMOUNT'; throw error; };
  const precision = decimals => {
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) invalid();
    return decimals;
  };
  const integer = value => {
    if (typeof value !== 'string' || value.length < 1 || value.length > 38 || /[^0-9]/.test(value) ||
        (value.length > 1 && value[0] === '0')) invalid();
    return value;
  };
  function parse(value, decimals = 6) {
    precision(decimals);
    if (typeof value !== 'string' || value.length > 57) invalid();
    const match = /^(0|[1-9][0-9]{0,37})(?:\.([0-9]+))?$/.exec(value);
    if (!match || match[0] !== value || (match[2]?.length ?? 0) > decimals) invalid();
    const scale = 10n ** BigInt(decimals), fraction = (match[2] ?? '').padEnd(decimals, '0');
    return integer((BigInt(match[1]) * scale + BigInt(fraction || '0')).toString());
  }
  function format(atomic, decimals = 6) {
    precision(decimals); integer(atomic);
    if (decimals === 0) return atomic;
    const padded = atomic.padStart(decimals + 1, '0'), fraction = padded.slice(-decimals).replace(/0+$/, '');
    return padded.slice(0, -decimals) + (fraction ? '.' + fraction : '');
  }
  window.FlowwUnits = Object.freeze({ parse, format });
})();
