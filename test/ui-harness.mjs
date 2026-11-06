import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const base = new URL('../service/web/', import.meta.url);
const html = await readFile(new URL('index.html', base), 'utf8');
const client = await readFile(new URL('workspace-client.js', base), 'utf8');
const taskClient = await readFile(new URL('app.js', base), 'utf8');
const units = await readFile(new URL('units.js', base), 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
const locale = await readFile(new URL('locale.js', base), 'utf8');
const A = '11111111111111111111111111111111', B = '11111111111111111111111111111112';
const TASK_A = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', TASK_B = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const CONVERSATION_A = 'cccccccc-cccc-4ccc-cccc-cccccccccccc', CONVERSATION_B = 'dddddddd-dddd-4ddd-dddd-dddddddddddd';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const response = (body, status = 200) => ({ status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body) });
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
async function until(check) {
  for (let i = 0; i < 100; i++) { if (check()) return; await new Promise(resolve => setImmediate(resolve)); }
  assert.ok(check(), 'scripted UI action did not reach the expected boundary');
}

// Execute the unmodified browser clients with inert DOM primitives. These tests
// exercise request ordering, public events and visible text; they do not assert
// implementation source strings, claim layout coverage, or contact a network.
function harness(source, fetcher, { languages = ['ko-KR'], savedLocale, storageDenied = false, hash = '' } = {}) {
  const nodes = [], ids = new Map(), intervals = new Map(), windowEvents = new Map(), events = [], backgroundErrors = [], downloads = [], blobs = new Map(); let timerId = 0;
  class Node {
    constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.attributes = {};
      this.listeners = new Map(); this.value = ''; this.checked = false; this.disabled = false; this.hidden = false; this.ownText = ''; nodes.push(this); }
    set textContent(value) { this.ownText = String(value ?? ''); this.children = []; }
    get textContent() { return this.ownText + this.children.map(child => typeof child === 'string' ? child : child.textContent).join(''); }
    append(...children) { for (const child of children) { if (child && typeof child === 'object') {
      child.remove(); child.parentNode = this;
    } this.children.push(child); } }
    appendChild(child) { this.append(child); return child; }
    insertBefore(child, reference) {
      if (reference == null) { this.append(child); return child; }
      if (!this.children.includes(reference)) throw new Error('Reference is not a child');
      if (child === reference) return child;
      child.remove(); child.parentNode = this;
      this.children.splice(this.children.indexOf(reference), 0, child); return child;
    }
    replaceChildren(...children) { for (const child of this.children) if (typeof child === 'object') child.parentNode = null; this.children = []; this.ownText = ''; this.append(...children); }
    setAttribute(key, value) { this.attributes[key] = String(value); if (key === 'class') this.className = String(value); if (['title', 'placeholder', 'lang'].includes(key)) this[key] = String(value); if (key.startsWith('data-')) this.dataset[key.slice(5)] = String(value); }
    getAttribute(key) { if (key === 'class') return this.className ?? null; if (key.startsWith('data-')) return this.dataset[key.slice(5)] ?? null; return this.attributes[key] ?? null; }
    hasAttribute(key) { return this.getAttribute(key) !== null; }
    removeAttribute(key) { delete this.attributes[key]; }
    get classList() { const node = this; return { add(...names) { const list = new Set((node.className ?? '').split(/\s+/).filter(Boolean)); names.forEach(name => list.add(name)); node.className = [...list].join(' '); },
      remove(...names) { node.className = (node.className ?? '').split(/\s+/).filter(name => name && !names.includes(name)).join(' '); },
      contains(name) { return (node.className ?? '').split(/\s+/).includes(name); },
      toggle(name, force) { const next = force ?? !this.contains(name); next ? this.add(name) : this.remove(name); return next; } }; }
    addEventListener(type, fn) { const values = this.listeners.get(type) ?? []; values.push(fn); this.listeners.set(type, values); }
    reportValidity() { return true; }
    reset() { const walk = node => { if (['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName)) {
      node.value = node.defaultValue ?? ''; node.checked = node.defaultChecked ?? false;
    } node.children.forEach(child => { if (typeof child === 'object') walk(child); }); }; walk(this); }
    focus() { document.activeElement = this; }
    scrollIntoView() {}
    contains(node) { return node === this || this.children.some(child => typeof child === 'object' && child.contains(node)); }
    get parentElement() { return this.parentNode ?? null; }
    querySelectorAll(selector) { return select(this, selector); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(node => node !== this); this.parentNode = null; }
    async trigger(type, extra = {}) { await Promise.all((this.listeners.get(type) ?? []).map(fn => fn({ type, target: this, currentTarget: this, preventDefault() {}, ...extra }))); }
    click() { if (this.tagName === 'A' && blobs.has(this.href)) downloads.push({ name: this.download, blob: blobs.get(this.href) });
      const action = this.trigger('click'); action.catch(error => backgroundErrors.push(error)); return action; }
    requestSubmit(submitter) { const action = this.trigger('submit', { submitter }); action.catch(error => backgroundErrors.push(error)); return action; }
    set innerHTML(_) { throw new Error('Raw HTML insertion is not supported by this security harness'); }
  }
  const root = new Node('document'), stack = [root], voids = new Set(['meta', 'link', 'input', 'br', 'hr', 'img', 'path', 'rect']);
  for (const match of html.matchAll(/<(\/?)([a-z][a-z0-9-]*)\b([^>]*)>/gi)) {
    const [, closing, tag, attrs] = match;
    if (closing) {
      const index = stack.findLastIndex(node => node.tagName === tag.toUpperCase());
      if (index > 0) stack.length = index;
      continue;
    }
    const node = new Node(tag); stack.at(-1).append(node);
    for (const attr of attrs.matchAll(/([\w-]+)(?:="([^"]*)")?/g)) {
      const [, key, value = ''] = attr;
      node.attributes[key] = value;
      if (key === 'id') { node.id = value; assert.ok(!ids.has(value), 'duplicate HTML id'); ids.set(value, node); }
      if (key === 'class') node.className = value;
      if (key.startsWith('data-')) node.dataset[key.slice(5)] = value;
      if (key === 'value') node.value = node.defaultValue = value;
      if (key === 'checked') node.checked = node.defaultChecked = true;
      if (key === 'hidden') node.hidden = true;
      if (key === 'open') node.open = true;
    }
    if (!voids.has(tag.toLowerCase()) && !attrs.trim().endsWith('/')) stack.push(node);
  }
  function simple(node, selector) {
    const excluded = [...selector.matchAll(/:not\(([^()]*)\)/g)].map(match => match[1]);
    if (excluded.some(part => simple(node, part))) return false;
    selector = selector.replace(/:not\([^()]*\)/g, '');
    for (const match of selector.matchAll(/\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]/g)) {
      const value = node.getAttribute(match[1]), expected = match[2] ?? match[3] ?? match[4];
      if (value === null || (expected !== undefined && value !== expected)) return false;
    }
    selector = selector.replace(/\[[^\]]*\]/g, '');
    const tag = selector.match(/^[a-z][\w-]*/i)?.[0];
    if (tag && node.tagName !== tag.toUpperCase()) return false;
    for (const [, id] of selector.matchAll(/#([\w-]+)/g)) if (node.id !== id) return false;
    for (const [, name] of selector.matchAll(/\.([\w-]+)/g)) if (!node.classList.contains(name)) return false;
    return true;
  }
  function matches(node, selector) {
    const chain = selector.trim().split(/\s+/); let current = node;
    if (!simple(current, chain.pop())) return false;
    while (chain.length) {
      const next = chain.pop(); current = current.parentNode;
      while (current && !simple(current, next)) current = current.parentNode;
      if (!current) return false;
    }
    return true;
  }
  function select(scope, selector) {
    const descendants = []; const visit = node => { for (const child of node.children) if (typeof child === 'object') { descendants.push(child); visit(child); } }; visit(scope);
    return descendants.filter(node => selector.split(',').some(part => matches(node, part)));
  }
  const document = { hidden: false, body: nodes.find(node => node.tagName === 'BODY'), documentElement: nodes.find(node => node.tagName === 'HTML'), activeElement: null,
    getElementById: id => ids.get(id) ?? null, createElement: tag => new Node(tag),
    querySelectorAll: selector => select(root, selector), querySelector: selector => select(root, selector)[0] ?? null };
  class Event { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } }
  const window = { scrollTo() {}, addEventListener(type, fn) { const values = windowEvents.get(type) ?? []; values.push(fn); windowEvents.set(type, values); },
    dispatchEvent(event) { events.push(event); for (const fn of windowEvents.get(event.type) ?? []) fn(event); return true; } };
  const historyEntries = [{ url: new URL('https://floww.example/' + hash).href, state: null }], historyWrites = []; let historyIndex = 0;
  const currentURL = () => new URL(historyEntries[historyIndex].url);
  window.location = { get href() { return currentURL().href; }, get origin() { return currentURL().origin; },
    get pathname() { return currentURL().pathname; }, get search() { return currentURL().search; }, get hash() { return currentURL().hash; },
    set hash(value) { const next = currentURL(); next.hash = value; if (next.href === currentURL().href) return;
      historyEntries.splice(historyIndex + 1); historyEntries.push({ url: next.href, state: null }); historyIndex++;
      window.dispatchEvent(new Event('hashchange')); } };
  function writeHistory(kind, value, url) {
    const target = new URL(url, currentURL()); if (target.origin !== currentURL().origin) throw new Error('Cross-origin history URL');
    const entry = { url: target.href, state: value };
    historyWrites.push({ kind, ...entry });
    if (kind === 'replace') historyEntries[historyIndex] = entry;
    else { historyEntries.splice(historyIndex + 1); historyEntries.push(entry); historyIndex++; }
  }
  window.history = { get state() { return historyEntries[historyIndex].state; }, get length() { return historyEntries.length; },
    pushState(value, _, url) { writeHistory('push', value, url); }, replaceState(value, _, url) { writeHistory('replace', value, url); },
    go(delta) { const next = historyIndex + delta; if (next < 0 || next >= historyEntries.length || next === historyIndex) return;
      const oldHash = currentURL().hash; historyIndex = next; window.dispatchEvent(new Event('popstate'));
      if (oldHash !== currentURL().hash) window.dispatchEvent(new Event('hashchange')); },
    back() { this.go(-1); }, forward() { this.go(1); } };
  const storage = new Map(savedLocale === undefined ? [] : [['floww.ui.locale', savedLocale]]), storageWrites = [];
  window.navigator = { languages, language: languages[0] };
  window.localStorage = {
    getItem(key) { if (storageDenied) throw new Error('Storage unavailable'); return storage.get(key) ?? null; },
    setItem(key, value) { if (storageDenied) throw new Error('Storage unavailable'); storageWrites.push([key, String(value)]); storage.set(key, String(value)); },
  };
  const calls = [];
  class BrowserURL extends URL {
    static createObjectURL(blob) { const key = 'blob:scripted-ui-' + blobs.size; blobs.set(key, blob); return key; }
    static revokeObjectURL(key) { blobs.delete(key); }
  }
  const context = { document, window, CustomEvent: Event, Option: function Option(text, value) { const n = new Node('option'); n.textContent = text; n.value = value; return n; },
    fetch: async (url, options) => { const call = { url: String(url), ...options, body: options?.body ? JSON.parse(options.body) : undefined }; calls.push(call); return fetcher(call); },
    setInterval(fn) { const id = ++timerId; intervals.set(id, fn); return id; }, clearInterval(id) { intervals.delete(id); },
    setTimeout() { return ++timerId; }, clearTimeout() {}, AbortController, URL: BrowserURL, URLSearchParams, Intl, Date,
    TextEncoder, Uint8Array, Blob, btoa, queueMicrotask, crypto: globalThis.crypto };
  vm.runInNewContext(units + '\n' + locale + '\n' + source, context, { filename: 'browser-client-under-test.js' });
  return { document, window, nodes, calls, intervals, events, backgroundErrors, get: id => ids.get(id),
    storage, storageWrites, downloads, historyEntries, historyWrites,
    emit(type, detail) { window.dispatchEvent(new Event(type, { detail })); },
    session(wallet, health = { ready: false }) { window.dispatchEvent(new Event('floww:session', { detail: { wallet, health } })); },
    nav(name) { return nodes.find(node => node.dataset.view === name).trigger('click'); } };
}

function task(id, purpose, payment = 'NOT_STARTED') {
  return { id, revision: 1, purpose, wallet: id === TASK_A ? A : B,
    windowStart: '2026-11-04T00:00:00Z', windowEnd: '2026-11-05T00:00:00Z', createdAt: '2026-11-05T12:00:00Z',
    policy: 'PENDING', payment, delivery: 'NOT_STARTED', events: [], result: null, quote: null, approval: null };
}
function overview() { return { tasks: { active: 0, resultAvailable: 0, recoveryRequired: 0 }, workspace: { memory: 0 },
  budget: { spentAtomic: '0', heldAtomic: '0', activeMandates: 0, dailyLimitAtomic: '1000', reservations: [] }, activity: [] }; }
function conversation(id, owner, withPlan = true) {
  const scope = { purpose: owner === A ? 'A private plan' : 'B private plan', wallet: owner,
    windowStart: '2026-11-04T00:00:00.000Z', windowEnd: '2026-11-05T00:00:00.000Z', resourceId: 'wallet-transfers', missingFields: [] };
  return { id, revision: 1, intentRevision: 1, title: scope.purpose, status: 'APPROVAL_REQUIRED', intent: scope,
    messages: [{ id: id + '-message', role: 'user', text: scope.purpose, at: '2026-11-05T12:00:00Z' }],
    plan: withPlan ? { hash: (owner === A ? 'a' : 'b').repeat(64), scope, summary: scope.purpose, intentRevision: 1,
      steps: [{ role: 'planner', capability: 'wallet-transfers', resourceId: 'wallet-transfers', reason: 'Scripted browser fixture' }],
      limitations: ['Scripted local behavior only'], modelVersion: 'scripted-test' } : null };
}

export { harness, html, client, taskClient, units, A, B, TASK_A, TASK_B, CONVERSATION_A, CONVERSATION_B, deferred, response, settle, until, task, overview, conversation };
