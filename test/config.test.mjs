import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../service/config.mjs';

test('local startup cannot implicitly bind the service to the network', () => {
  assert.equal(loadConfig({}).host, '127.0.0.1');
  assert.throws(() => loadConfig({ FLOWW_HOST: '0.0.0.0' }), { code: 'LOCAL_BIND_REQUIRED' });
  assert.throws(() => loadConfig({ FLOWW_DEPLOYMENT_MODE: 'typo' }), { code: 'INVALID_CONFIGURATION' });
});

test('remote startup requires both HTTPS exact origin and persistent managed state', () => {
  const base = { FLOWW_DEPLOYMENT_MODE: 'remote', FLOWW_HOST: '0.0.0.0', PORT: '10000' };
  assert.throws(() => loadConfig(base), { code: 'REMOTE_CONFIGURATION_REQUIRED' });
  assert.throws(() => loadConfig({ ...base, FLOWW_PUBLIC_ORIGIN: 'https://floww.example' }), { code: 'REMOTE_CONFIGURATION_REQUIRED' });
  assert.throws(() => loadConfig({ ...base, FLOWW_PUBLIC_ORIGIN: 'http://127.0.0.1', DATABASE_URL: 'postgresql://db.example/floww' }), { code: 'REMOTE_CONFIGURATION_REQUIRED' });
  assert.throws(() => loadConfig({ ...base, FLOWW_PUBLIC_ORIGIN: 'https://localhost', DATABASE_URL: 'postgresql://db.example/floww' }), { code: 'REMOTE_CONFIGURATION_REQUIRED' });
  for (const hostname of ['127.0.0.2', '127.255.255.254', '2130706434',
    '[::1]', '[::ffff:127.0.0.1]', '[::ffff:7f00:2]', 'localhost.', 'app.localhost']) {
    assert.throws(() => loadConfig({ ...base, FLOWW_PUBLIC_ORIGIN: `https://${hostname}`,
      DATABASE_URL: 'postgresql://db.example/floww' }), { code: 'REMOTE_CONFIGURATION_REQUIRED' });
  }
  const config = loadConfig({ ...base, RENDER_EXTERNAL_URL: 'https://floww-solana.onrender.com', DATABASE_URL: 'postgresql://db.example/floww' });
  assert.equal(config.origin, 'https://floww-solana.onrender.com');
  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.port, 10000);
  assert.equal(config.secureCookies, true);
  assert.equal(config.paymentEnabled, false);
  assert.equal(config.cookieName, '__Host-floww_session');
});
