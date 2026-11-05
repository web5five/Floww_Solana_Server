import { createServer } from 'node:http';
import { constants, openSync, closeSync, fstatSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createApp } from './app.mjs';
import { loadConfig, ServiceError } from './config.mjs';
import { Store } from './store.mjs';
import { createRpc } from './network.mjs';
import { createGateway, mountMerchant } from './x402.mjs';
import { createReportProvider } from './provider.mjs';
import { createAiBridge } from './ai.mjs';

export function readPayerKey(path) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 4096 ||
        (stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())) throw new Error();
    const value = JSON.parse(readFileSync(fd, 'utf8'));
    if (!Array.isArray(value) || value.length !== 64 || value.some(x => !Number.isInteger(x) || x < 0 || x > 255)) throw new Error();
    return Uint8Array.from(value);
  } catch { throw new ServiceError('PAYER_KEY_UNAVAILABLE', 500); }
  finally { if (fd !== undefined) closeSync(fd); }
}
export async function buildRuntime(input = {}) {
  const base = input.config ?? loadConfig();
  // Configuration remains server-only. Disabled execution does not read a key.
  const config = Object.freeze({ ...base,
    payerPrivateKey: base.payerPrivateKey ?? (base.paymentEnabled && base.payerKeyFile ? readPayerKey(base.payerKeyFile) : null),
  });
  let store = input.store;
  if (!store && config.databaseUrl) {
    const { PostgresStore } = await import('./postgres-store.mjs');
    store = await PostgresStore.open(config.databaseUrl);
  }
  store ??= new Store(config.dbPath);
  const rpc = input.rpc ?? createRpc(config.rpcUrl, { timeoutMs: config.requestTimeoutMs });
  const gateway = input.gateway ?? createGateway(config, { rpc });
  const reportProvider = input.reportProvider ?? createReportProvider({ rpc });
  const ai = input.ai ?? createAiBridge({ python: config.python, model: config.model ?? undefined, apiKey: config.apiKey ?? undefined });
  const app = createApp({ config, store, gateway, reportProvider, ai, mountMerchant: input.mountMerchant ?? mountMerchant });
  return { app, config, store, gateway, reportProvider, ai };
}
export async function start(input = {}) {
  const runtime = await buildRuntime(input);
  const server = createServer(runtime.app);
  server.requestTimeout = 90_000; server.headersTimeout = 15_000; server.keepAliveTimeout = 5_000;
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(runtime.config.port, runtime.config.host, resolve);
  });
  return { ...runtime, server, close: async () => {
    server.closeIdleConnections(); await new Promise(resolve => server.close(resolve)); await runtime.store.close();
  } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start().then(runtime => {
    // No environment dump, private key, proof or merchant response is logged.
    process.stdout.write('Floww service started.\n');
    let closing = false;
    const close = async () => { if (closing) return; closing = true; await runtime.close(); };
    process.once('SIGTERM', close); process.once('SIGINT', close);
  }).catch(() => { process.stderr.write('FLOWW_START_FAILED\n'); process.exitCode = 1; });
}
