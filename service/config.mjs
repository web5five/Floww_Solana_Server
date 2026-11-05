import { address } from '@solana/kit';
import { USDC_DEVNET_ADDRESS } from '@x402/svm';
import { resolve } from 'node:path';
import { BlockList, isIP } from 'node:net';

const loopbacks = new BlockList();
loopbacks.addSubnet('127.0.0.0', 8, 'ipv4');
loopbacks.addAddress('::1', 'ipv6');
const isLoopback = hostname => {
  const host = hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  const family = isIP(host);
  return host === 'localhost' || host.endsWith('.localhost') ||
    (family !== 0 && loopbacks.check(host, family === 6 ? 'ipv6' : 'ipv4'));
};

export const DEVNET = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
export class ServiceError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
export const fail = (code, status) => { throw new ServiceError(code, status); };
export const isAddress = value => {
  try { return typeof value === 'string' && address(value) === value; } catch { return false; }
};
export function atomic(value) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,38})$/.test(value)) fail('INVALID_AMOUNT');
  return BigInt(value);
}
export function exact(value, fields) {
  if (!value || Array.isArray(value) || typeof value !== 'object' ||
      Object.keys(value).some(key => !fields.includes(key))) fail('INVALID_REQUEST');
}
export function iso(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) ||
      !Number.isFinite(Date.parse(value))) fail('INVALID_TIME');
  return new Date(value).toISOString();
}
function endpoint(value, { originOnly = false } = {}) {
  const url = new URL(value);
  const local = isLoopback(url.hostname);
  if (url.username || url.password || url.hash || url.search ||
      (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
      (originOnly && url.pathname !== '/')) fail('INVALID_CONFIGURATION', 500);
  return originOnly ? url.origin : url.href.replace(/\/$/, '');
}
export function loadConfig(env = process.env) {
  const deploymentMode = env.FLOWW_DEPLOYMENT_MODE || 'local';
  if (!['local', 'remote'].includes(deploymentMode)) fail('INVALID_CONFIGURATION', 500);
  const remote = deploymentMode === 'remote';
  const origin = endpoint(env.FLOWW_PUBLIC_ORIGIN || (remote && env.RENDER_EXTERNAL_URL) || 'http://127.0.0.1:4318', { originOnly: true });
  const originUrl = new URL(origin);
  const network = env.X402_NETWORK || DEVNET;
  if (network !== DEVNET) fail('DEVNET_ONLY', 500);
  const host = env.FLOWW_HOST || '127.0.0.1';
  const localHost = ['127.0.0.1', 'localhost', '::1'].includes(host);
  if (!localHost && !(remote && host === '0.0.0.0')) fail('LOCAL_BIND_REQUIRED', 500);
  // A remote service cannot silently use disposable container-local state or an
  // insecure wallet-sign-in origin. Exposure remains an explicit release choice.
  if (remote && (originUrl.protocol !== 'https:' ||
      isLoopback(originUrl.hostname) || !env.DATABASE_URL)) {
    fail('REMOTE_CONFIGURATION_REQUIRED', 500);
  }
  const merchantPayTo = env.MERCHANT_PAY_TO || '';
  const asset = env.PAYMENT_ASSET_MINT || USDC_DEVNET_ADDRESS;
  if ((merchantPayTo && !isAddress(merchantPayTo)) || !isAddress(asset)) fail('INVALID_CONFIGURATION', 500);
  const amountAtomic = env.PAYMENT_AMOUNT_ATOMIC || '1000';
  const maxPaymentAtomic = env.FLOWW_MAX_PAYMENT_ATOMIC || '1000000';
  if (atomic(amountAtomic) <= 0n || atomic(amountAtomic) > atomic(maxPaymentAtomic)) fail('INVALID_CONFIGURATION', 500);
  const port = Number(env.PORT || originUrl.port || (originUrl.protocol === 'https:' ? 443 : 80));
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail('INVALID_CONFIGURATION', 500);
  const paymentEnabled = env.FLOWW_ENABLE_DEVNET_PAYMENTS === 'true';
  return Object.freeze({
    origin, publicOrigin: origin, host, port, network, deploymentMode,
    cookieName: originUrl.protocol === 'https:' ? '__Host-floww_session' : 'floww_session',
    secureCookies: originUrl.protocol === 'https:',
    dbPath: resolve(env.FLOWW_DB_PATH || '.runtime/floww.sqlite'),
    databaseUrl: env.DATABASE_URL || null,
    rpcUrl: endpoint(env.SOLANA_RPC_URL || 'https://api.devnet.solana.com'),
    facilitatorUrl: endpoint(env.X402_FACILITATOR_URL || 'https://x402.org/facilitator'),
    merchantOrigin: origin, merchantBaseUrl: origin + '/merchant/reports',
    merchantPayTo, asset, assetDecimals: 6, amountAtomic, maxPaymentAtomic,
    paymentEnabled, payerKeyFile: env.FLOWW_PAYER_KEY_FILE || null,
    requestTimeoutMs: 12000, quoteTtlMs: 5 * 60_000, sessionTtlMs: 8 * 3600_000,
    model: env.FLOWW_MODEL || null, apiKey: env.OPENAI_API_KEY || null,
    python: env.FLOWW_PYTHON || 'python3',
  });
}
