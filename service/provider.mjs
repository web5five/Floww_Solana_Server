import { createHash } from 'node:crypto';
import { address, getBase58Encoder } from '@solana/kit';

export const DATA_NETWORK = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
export const DEVNET_GENESIS_HASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const SOURCE = 'solana:devnet:rpc';
const SYSTEM = '11111111111111111111111111111111';
const TOKEN_PROGRAMS = new Set([
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnVqSZHnqHx5h',
]);
const DAY = 86_400_000;
const MAX_REPORT = 256_000;

export class ProviderError extends Error {
  constructor(code) { super(code); this.name = 'ProviderError'; this.code = code; }
}

function isAddress(value) {
  try { return typeof value === 'string' && address(value) === value; }
  catch { return false; }
}
function isSignature(value) {
  try {
    return typeof value === 'string' && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(value)
      && getBase58Encoder().encode(value).length === 64;
  } catch { return false; }
}
function instant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)) {
    throw new ProviderError('INVALID_REPORT_SCOPE');
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new ProviderError('INVALID_REPORT_SCOPE');
  // Date.parse normalizes invalid calendar days; do not accept such scopes.
  if (new Date(time).toISOString().slice(0, 19) !== value.slice(0, 19)) {
    throw new ProviderError('INVALID_REPORT_SCOPE');
  }
  return time;
}
function nowMs(clock) {
  const value = clock();
  const time = value instanceof Date ? value.getTime() : value;
  if (!Number.isFinite(time)) throw new ProviderError('PROVIDER_CLOCK_INVALID');
  return time;
}
function positiveAtomic(value) {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) return null;
    return String(value);
  }
  return typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value)
    && BigInt(value) <= 18_446_744_073_709_551_615n ? value : null;
}

function tokenEvidence(meta, accountKeys) {
  const found = new Map();
  for (const [phase, entries] of [['pre', meta.preTokenBalances], ['post', meta.postTokenBalances]]) {
    if (!Array.isArray(entries)) continue;
    for (const item of entries) {
      if (!item || !Number.isInteger(item.accountIndex)) continue;
      const account = accountKeys[item.accountIndex];
      const decimals = item.uiTokenAmount?.decimals;
      if (!isAddress(account) || !isAddress(item.owner) || !isAddress(item.mint)
          || !Number.isInteger(decimals) || decimals < 0 || decimals > 18) continue;
      const value = { owner: item.owner, mint: item.mint, decimals };
      if (!found.has(account)) found.set(account, { value, phases: new Set([phase]) });
      else {
        const existing = found.get(account);
        if (!existing || JSON.stringify(existing.value) !== JSON.stringify(value)
            || existing.phases.has(phase)) found.set(account, null);
        else existing.phases.add(phase);
      }
    }
  }
  return new Map([...found].filter(([, entry]) => entry?.phases.size === 2)
    .map(([key, entry]) => [key, entry.value]));
}

function parsedTransfer(instruction, tokens) {
  const info = instruction?.parsed?.info;
  const type = instruction?.parsed?.type;
  if (!info || typeof info !== 'object') return null;
  if (instruction.programId === SYSTEM && instruction.program === 'system'
      && (type === 'transfer' || type === 'transferWithSeed')) {
    const amount = positiveAtomic(info.lamports);
    if (amount && isAddress(info.source) && isAddress(info.destination)) {
      return { asset_ref: 'solana:native:SOL', decimals: 9, amount_base_units: amount,
        from_wallet: info.source, to_wallet: info.destination };
    }
  }
  if (!TOKEN_PROGRAMS.has(instruction.programId) || !['spl-token', 'spl-token-2022'].includes(instruction.program)
      || !['transfer', 'transferChecked'].includes(type)) return null;
  const from = tokens.get(info.source), to = tokens.get(info.destination);
  if (!from || !to || from.mint !== to.mint || from.decimals !== to.decimals) return null;
  const amount = positiveAtomic(type === 'transferChecked' ? info.tokenAmount?.amount : info.amount);
  if (!amount || (type === 'transferChecked'
      && (info.mint !== from.mint || info.tokenAmount?.decimals !== from.decimals))) return null;
  return { asset_ref: from.mint, decimals: from.decimals, amount_base_units: amount,
    from_wallet: from.owner, to_wallet: to.owner };
}

function instructionsFor(transaction) {
  const outer = transaction.transaction.message.instructions;
  if (!Array.isArray(outer) || outer.length > 1_000) return [];
  const inner = new Map();
  for (const group of Array.isArray(transaction.meta.innerInstructions) ? transaction.meta.innerInstructions : []) {
    if (Number.isInteger(group?.index) && Array.isArray(group.instructions)
        && group.instructions.length < 1_000 && !inner.has(group.index)) {
      inner.set(group.index, group.instructions);
    }
  }
  return outer.flatMap((instruction, index) => [
    [instruction, index * 1_000],
    ...(inner.get(index) ?? []).map((item, child) => [item, index * 1_000 + child + 1]),
  ]);
}

/** A bounded wallet-account query, deliberately not an exhaustive indexer. */
export function createReportProvider({ rpc, clock = Date.now, maxTransactions = 40, totalTimeoutMs = 30_000 } = {}) {
  if (typeof rpc !== 'function' || typeof clock !== 'function'
      || !Number.isInteger(maxTransactions) || maxTransactions < 1 || maxTransactions > 100
      || !Number.isInteger(totalTimeoutMs) || totalTimeoutMs < 1 || totalTimeoutMs > 30_000) {
    throw new ProviderError('INVALID_PROVIDER_CONFIG');
  }
  return async function report({ resourceRef, wallet, windowStart, windowEnd, signal } = {}) {
    if (typeof resourceRef !== 'string' || !/^[A-Za-z0-9._:/-]{1,160}$/.test(resourceRef)
        || !isAddress(wallet)) throw new ProviderError('INVALID_REPORT_SCOPE');
    const start = instant(windowStart), end = instant(windowEnd), began = nowMs(clock);
    if (!(start < end && end <= began && end - start <= 7 * DAY)) {
      throw new ProviderError('INVALID_REPORT_SCOPE');
    }
    if (signal !== undefined && !(signal instanceof AbortSignal)) throw new ProviderError('INVALID_REPORT_SCOPE');
    const deadline = AbortSignal.timeout(totalTimeoutMs);
    const reportSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
    const cancelled = () => new ProviderError(signal?.aborted ? 'PROVIDER_CANCELLED' : 'PROVIDER_TIMEOUT');
    const call = async (method, params) => {
      if (reportSignal.aborted) throw cancelled();
      try {
        const value = await rpc(method, params, { signal: reportSignal });
        if (reportSignal.aborted) throw cancelled();
        return value;
      } catch {
        if (reportSignal.aborted) throw cancelled();
        throw new ProviderError('RPC_UNAVAILABLE');
      }
    };
    if (await call('getGenesisHash', []) !== DEVNET_GENESIS_HASH) {
      throw new ProviderError('DATA_NETWORK_MISMATCH');
    }
    const signatures = await call('getSignaturesForAddress', [wallet,
      { limit: maxTransactions, commitment: 'confirmed' }]);
    if (!Array.isArray(signatures) || signatures.length > maxTransactions) {
      throw new ProviderError('INVALID_RPC_RESPONSE');
    }
    let paginationComplete = signatures.length < maxTransactions, malformedPage = false;
    const seen = new Set(), transfers = [];
    for (const row of signatures) {
      if (!row || !isSignature(row.signature) || seen.has(row.signature)
          || !Number.isSafeInteger(row.blockTime) || row.blockTime < 0) {
        malformedPage = true; continue;
      }
      seen.add(row.signature);
      const time = row.blockTime * 1_000;
      if (time < start) { paginationComplete = true; continue; }
      if (time >= end || row.err !== null) continue;
      const transaction = await call('getTransaction', [row.signature,
        { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]);
      if (!transaction || !transaction.meta || transaction.meta.err !== null
          || !transaction.transaction?.signatures?.includes(row.signature)
          || transaction.blockTime !== row.blockTime
          || !Array.isArray(transaction.transaction?.message?.accountKeys)) continue;
      const keys = transaction.transaction.message.accountKeys.map(item =>
        typeof item === 'string' ? item : item?.pubkey);
      const instructions = instructionsFor(transaction);
      const tokenAuthorityStable = instructions.every(([instruction]) =>
        !TOKEN_PROGRAMS.has(instruction?.programId)
        || ['transfer', 'transferChecked', 'approve', 'approveChecked', 'revoke',
          'syncNative', 'freezeAccount', 'thawAccount'].includes(instruction?.parsed?.type));
      const tokens = tokenAuthorityStable ? tokenEvidence(transaction.meta, keys) : new Map();
      for (const [instruction, eventIndex] of instructions) {
        const transfer = parsedTransfer(instruction, tokens);
        if (!transfer || ![transfer.from_wallet, transfer.to_wallet].includes(wallet)) continue;
        if (transfers.length === 500) break;
        const digest = createHash('sha256').update(row.signature).digest('hex').slice(0, 40);
        transfers.push({ record_id: `tx-${digest}-${eventIndex}`, source_ref: SOURCE,
          transaction_ref: row.signature, event_index: eventIndex,
          timestamp: new Date(time).toISOString(), ...transfer });
      }
    }
    const finished = nowMs(clock);
    if (finished < began) throw new ProviderError('PROVIDER_CLOCK_INVALID');
    const result = { schema_version: 'analytics-reference/v1', resource_ref: resourceRef,
      wallet, data_network: DATA_NETWORK, window_start: new Date(start).toISOString(),
      window_end: new Date(end).toISOString(), generated_at: new Date(finished).toISOString(),
      data_as_of: new Date(end).toISOString(),
      coverage: { complete: false, pagination_complete: paginationComplete && !malformedPage },
      is_synthetic: false, source_refs: [SOURCE], transfers };
    // A wallet-account query omits token-account-only history and unsupported
    // instructions. Its response must never assert complete wallet coverage.
    while (Buffer.byteLength(JSON.stringify(result)) > MAX_REPORT && transfers.length) transfers.pop();
    if (Buffer.byteLength(JSON.stringify(result)) > MAX_REPORT) throw new ProviderError('REPORT_TOO_LARGE');
    return result;
  };
}
