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
import { createPlanner } from './planner.mjs';
import { WorkspaceStore } from './workspace-store.mjs';
import { mountWorkspace } from './workspace.mjs';
import { createMandateService } from './mandates.mjs';
import { createRequestTelemetry } from './observability.mjs';
import { createShutdown } from './lifecycle.mjs';
import { checkPythonAdapters, freezeAdapterStatus } from './adapter-preflight.mjs';

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
  // Immutable packaging capability, checked once even when inference is disabled.
  // An explicit programmatic snapshot is the only trusted test-adapter override.
  const adapterStatus = input.adapterStatus === undefined
    ? await checkPythonAdapters({ python: config.python, signal: input.signal })
    : freezeAdapterStatus(input.adapterStatus);
  let store = input.store;
  if (!store && config.databaseUrl) {
    const { PostgresStore } = await import('./postgres-store.mjs');
    store = await PostgresStore.open(config.databaseUrl, { caPem: config.databaseCaPem });
  }
  store ??= new Store(config.dbPath);
  const rpc = input.rpc ?? createRpc(config.rpcUrl, { timeoutMs: config.requestTimeoutMs });
  const gateway = input.gateway ?? createGateway(config, { rpc });
  const reportProvider = input.reportProvider ?? createReportProvider({ rpc });
  const ai = input.ai ?? createAiBridge({ python: config.python, model: config.model ?? undefined, apiKey: config.apiKey ?? undefined });
  const planner = input.planner ?? createPlanner({ python: config.python, model: config.model, apiKey: config.apiKey });
  const workspace = await WorkspaceStore.open(store);
  const mandates = await createMandateService({ store, config });
  const telemetry = createRequestTelemetry({ write: input.writeLog });
  const app = createApp({ config, store, gateway, reportProvider, ai, adapterStatus, telemetry, mountMerchant: input.mountMerchant ?? mountMerchant,
    observeRequest: input.observeRequest ?? telemetry.observeRequest,
    mountWorkspace: (app, context) => mountWorkspace(app, { repo: workspace, planner, mandates }, context),
    runtimeReadiness: () => mandates.readiness(),
    taskHooks: {
      beforeClaim: ({ task, owner }) => mandates.reserve(owner, task),
      beforeSign: ({ task, owner }) => mandates.assertReservation(owner, task),
      observed: ({ task, owner }) => mandates.observe(owner, task),
    },
  });
  return { app, config, store, gateway, reportProvider, ai, planner, workspace, mandates, telemetry, adapterStatus: app.locals.adapterStatus, lifecycle: app.locals.lifecycle };
}
export async function start(input = {}) {
  const runtime = await buildRuntime(input);
  const server = createServer(runtime.app);
  server.requestTimeout = 90_000; server.headersTimeout = 15_000; server.keepAliveTimeout = 5_000;
  const close = createShutdown({ server, store: runtime.store, lifecycle: runtime.lifecycle,
    graceMs: input.shutdownGraceMs, storeCloseMs: input.storeCloseMs });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject); server.listen(runtime.config.port, runtime.config.host, resolve);
    });
  } catch (error) { await runtime.store.close(); throw error; }
  return { ...runtime, server, close };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start().then(runtime => {
    // No environment dump, private key, proof or merchant response is logged.
    process.stdout.write('Floww service started.\n');
    let closing = false;
    const close = async () => {
      if (closing) return; closing = true;
      try {
        const result = await runtime.close();
        if (!result.drained || !result.storeClosed) { process.stderr.write('FLOWW_DRAIN_INCOMPLETE\n'); process.exitCode = 1; }
      } catch { process.stderr.write('FLOWW_DRAIN_FAILED\n'); process.exitCode = 1; }
    };
    process.once('SIGTERM', close); process.once('SIGINT', close);
  }).catch(() => { process.stderr.write('FLOWW_START_FAILED\n'); process.exitCode = 1; });
}
