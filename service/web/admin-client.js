(() => {
  'use strict';
  const $ = id => document.getElementById(id), locale = window.FlowwLocale, copy = locale.copy;
  const state = { wallet: null, generation: null, ready: false, epoch: 0, read: 0, dataEpoch: 0,
    active: document.body.dataset.currentView === 'admin', section: 'overview', role: 'unknown', expires: 0,
    busy: false, controllers: new Set(), expiryTimer: null, sources: {}, requestLimit: 25, eventLimit: 25 };
  const scopes = { runtime: 'current-process', tasks: 'current-persisted-task-states', usage: 'last-seven-utc-days-admitted-role-calls',
    executions: 'last-seven-utc-days-global-ledger-buckets', events: 'newest-retained-task-events', requests: 'current-process' };
  const scopeLabels = { runtime: 'admin.processScope', tasks: 'admin.taskScope', usage: 'admin.usageScope',
    executions: 'admin.executionScope', events: 'admin.eventScope', requests: 'admin.requestScope' };
  const policy = ['PENDING', 'ALLOW', 'DENY', 'OTHER'], payment = ['NOT_STARTED', 'SIGNING', 'PENDING', 'UNKNOWN', 'CONFIRMED', 'FAILED', 'OTHER'],
    delivery = ['NOT_STARTED', 'PENDING', 'COMPLETED', 'FAILED', 'OTHER'];
  const statusKeys = { PENDING: 'admin.pending', ALLOW: 'admin.allowed', DENY: 'admin.denied', OTHER: 'admin.other',
    NOT_STARTED: 'admin.notStarted', SIGNING: 'admin.signing', UNKNOWN: 'admin.paymentUnknown', CONFIRMED: 'admin.confirmed',
    FAILED: 'admin.failed', COMPLETED: 'admin.delivered' };
  const eventLabels = ['TASK_CREATED', 'QUOTE_READY', 'APPROVED', 'POLICY_DENIED', 'APPROVAL_REVOKED', 'EXECUTION_CLAIMED',
    'PAYMENT_PREPARED', 'PAYMENT_OBSERVED', 'PAYMENT_RECONCILED', 'RECOVERY_REQUIRED', 'OPERATION_STOPPED', 'REPORT_READY', 'REPORT_REJECTED', 'OTHER'];
  const reasonLabels = ['QUOTE_REQUIRED', 'APPROVAL_REQUIRED', 'APPROVED', 'APPROVAL_REVOKED', 'SIGNING', 'PENDING', 'RESOURCE_DELIVERED',
    'PAYMENT_CONFIRMED', 'CHAIN_CONFIRMED', 'REPORT_READY', 'REPORT_INVALID', 'PROCESS_RESTART_RECONCILE', 'LEASE_EXPIRED_RECONCILE',
    'OPERATION_LEASE_EXPIRED', 'PAYMENT_RECONCILIATION_REQUIRED', 'TRANSACTION_FAILED', 'SETTLEMENT_UNCONFIRMED', 'RECONCILIATION_UNAVAILABLE',
    'PAID_RESOURCE_UNAVAILABLE', 'INVALID_PAID_RESOURCE', 'BUDGET_DENIED', 'UNAUTHORIZED_PAYMENT_TERMS', 'APPROVAL_EXPIRED', 'PAYER_CHANGED',
    'QUOTE_CHANGED', 'UNAPPROVED_PAYMENT_TERMS', 'DAILY_BUDGET_EXCEEDED', 'MANDATE_BUDGET_EXCEEDED', 'MANDATE_EXPIRED', 'MANDATE_REVOKED',
    'MANDATE_VERSION_CHANGED', 'REPORT_ADAPTER_UNAVAILABLE', 'AI_PROCESS_FAILED', 'AI_TIMEOUT', 'AI_CANCELLED', 'AI_INVALID_OUTPUT',
    'RPC_UNAVAILABLE', 'FACILITATOR_UNAVAILABLE', 'SIGNING_DEADLINE_EXCEEDED', 'PAYMENT_BINDING_MISMATCH', 'INTEGRATION_UNAVAILABLE', 'OTHER'];
  const routes = ['liveness', 'readiness', 'capabilities', 'session', 'login_challenge', 'login_verify', 'logout', 'tasks', 'task_detail',
    'task_archive', 'task_restore', 'task_quote', 'task_approve', 'task_revoke', 'task_execute', 'task_reconcile', 'task_recover',
    'catalog', 'dashboard', 'activity', 'conversations', 'conversation_detail', 'conversation_messages', 'conversation_plan', 'conversation_confirm',
    'memories', 'memory_detail', 'mandates', 'mandate_revoke', 'admin_access', 'admin_overview', 'admin_events', 'admin_requests',
    'voice_capabilities', 'voice_transcription', 'merchant_report', 'unclassified'];
  const methods = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'OTHER'];
  const palette = ['#c5cee2', '#7e89bc', '#d59b2b', '#d74c78', '#506eff', '#9573c9', '#68758c'];
  const put = (node, value) => locale.text(node, value, () => state.dataEpoch);
  const el = (tag, value, className) => { const node = document.createElement(tag); if (value !== undefined) put(node, value); if (className) node.className = className; return node; };
  const svg = (tag, attributes = {}) => { const node = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attributes)) node.setAttribute(k, v); return node; };
  const integer = value => { if (!Number.isSafeInteger(value) || value < 0) throw Error('INVALID'); return value; };
  const sum = values => { const value = values.reduce((a, b) => a + b, 0); return integer(value); };
  const time = value => { if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw Error('INVALID'); return value; };
  const bool = value => { if (typeof value !== 'boolean') throw Error('INVALID'); return value; };
  const list = (value, max) => { if (!Array.isArray(value) || value.length > max) throw Error('INVALID'); return value; };
  const literal = (value, allowed) => { if (!allowed.includes(value)) throw Error('INVALID'); return value; };
  const formatDate = value => new Intl.DateTimeFormat(locale.language === 'ko' ? 'ko-KR' : 'en-US', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short', hourCycle: 'h23' }).format(new Date(value));
  const date = value => () => formatDate(value);
  const formatCount = value => new Intl.NumberFormat(locale.language === 'ko' ? 'ko-KR' : 'en-US').format(value);
  const count = value => () => formatCount(value);
  const unavailable = code => ({ status: 'unavailable', code: ['ADMIN_SOURCE_TIMEOUT', 'ADMIN_SOURCE_UNSUPPORTED'].includes(code) ? code : 'ADMIN_SOURCE_UNAVAILABLE' });
  function partition(value, keys, total) { const result = Object.fromEntries(keys.map(key => [key, integer(value?.[key])])); if (sum(Object.values(result)) !== total) throw Error('INVALID'); return result; }
  function project(name, source) {
    try {
      if (!source || source.scope !== scopes[name]) throw Error('INVALID');
      if (source.status === 'unavailable' && source.capturedAt === null && source.data === undefined) return unavailable(source.code);
      if (source.status !== 'ready') throw Error('INVALID');
      const capturedAt = time(source.capturedAt), d = source.data; let data;
      if (name === 'tasks') {
        const total = integer(d.total); data = { total, active: integer(d.active), archived: integer(d.archived), reportAvailable: integer(d.reportAvailable), recoveryRequired: integer(d.recoveryRequired),
          attention: Object.fromEntries(['unresolvedPayments', 'confirmedUndelivered', 'deliveredWithoutReport'].map(k => [k, integer(d.attention?.[k])])),
          policy: partition(d.policy, policy, total), payment: partition(d.payment, payment, total), delivery: partition(d.delivery, delivery, total),
          coverage: { archivedIncluded: bool(d.coverage?.archivedIncluded), invalidStateTasks: integer(d.coverage?.invalidStateTasks), invalidReportShapes: integer(d.coverage?.invalidReportShapes) } };
        if (!data.coverage.archivedIncluded || data.active + data.archived !== total || sum(Object.values(data.attention)) !== data.recoveryRequired ||
            [data.reportAvailable, data.recoveryRequired, data.coverage.invalidStateTasks, data.coverage.invalidReportShapes].some(n => n > total) ||
            data.attention.unresolvedPayments !== sum(['SIGNING', 'PENDING', 'UNKNOWN'].map(k => data.payment[k])) ||
            sum([data.attention.confirmedUndelivered, data.attention.deliveredWithoutReport]) > data.payment.CONFIRMED ||
            sum([data.reportAvailable, data.attention.deliveredWithoutReport]) > total) throw Error('INVALID');
      } else if (name === 'runtime') {
        data = { startedAt: time(d.startedAt), minuteWindowFrom: time(d.minuteWindowFrom), minuteWindowThrough: time(d.minuteWindowThrough),
          ...Object.fromEntries(['completed', 'incomplete', 'suppressed', 'unmeasuredLatency', 'unmeasuredTime', 'clockRegressions'].map(k => [k, integer(d[k])])),
          capabilities: Object.fromEntries(['workspaceAdapterReady', 'reportAdapterReady', 'modelConfigured', 'paymentEnabled'].map(k => [k, bool(d.capabilities?.[k])])), draining: bool(d.draining), countersCapped: bool(d.countersCapped) };
        const limits = [10, 50, 100, 250, 500, 1000, 2500, 5000, 15000, 60000, null];
        data.latencyBuckets = list(d.latencyBuckets, 11).map((r, i) => { if (r.upperMs !== limits[i]) throw Error('INVALID'); return { upperMs: r.upperMs, count: integer(r.count) }; });
        if (data.latencyBuckets.length !== 11) throw Error('INVALID');
        data.counts = list(d.counts, methods.length * routes.length * 6).map(r => ({ method: literal(r.method, methods), route: literal(r.route, routes), statusClass: literal(r.statusClass, ['1xx', '2xx', '3xx', '4xx', '5xx', 'incomplete']), count: integer(r.count) }));
        data.minuteBuckets = list(d.minuteBuckets, 60).map(r => ({ minute: time(r.minute), completed: integer(r.completed), incomplete: integer(r.incomplete) }));
        const from = Date.parse(data.minuteWindowFrom), through = Date.parse(data.minuteWindowThrough);
        if (data.startedAt > data.minuteWindowFrom || from > through || data.minuteWindowThrough !== capturedAt || !data.minuteBuckets.length) throw Error('INVALID');
        const expectedFirst = Math.floor(from / 60_000) * 60_000, expectedLast = Math.floor(through / 60_000) * 60_000;
        if (data.minuteBuckets.length !== (expectedLast - expectedFirst) / 60_000 + 1 || data.minuteBuckets.some((r, i) => Date.parse(r.minute) !== expectedFirst + i * 60_000)) throw Error('INVALID');
        const total = sum([data.completed, data.incomplete]);
        if (sum(data.counts.map(r => r.count)) !== total || sum(data.latencyBuckets.map(r => r.count)) + data.unmeasuredLatency !== total || sum(data.minuteBuckets.map(r => sum([r.completed, r.incomplete]))) > total) throw Error('INVALID');
      } else if (name === 'usage' || name === 'executions') {
        data = { days: list(d.days, 7).map(r => { if (typeof r.day !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(r.day) || new Date(r.day).toISOString().slice(0, 10) !== r.day) throw Error('INVALID');
          return { day: r.day, ...Object.fromEntries((name === 'usage' ? ['admittedRoleCalls'] : ['heldExecutions', 'observedExecutions']).map(k => [k, integer(r[k])])) }; }) };
        if (data.days.length !== 7 || data.days.some((r, i, all) => i && Date.parse(r.day) !== Date.parse(all[i - 1].day) + 86_400_000)) throw Error('INVALID');
        if (name === 'usage') data.limitPerDay = integer(d.limitPerDay);
      } else if (name === 'requests') {
        data = { requests: list(d.requests, state.requestLimit).map(r => {
          if (r.requestId !== null && (typeof r.requestId !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(r.requestId))) throw Error('INVALID');
          const outcome = literal(r.outcome, ['completed', 'incomplete']);
          if (outcome === 'completed' ? !Number.isInteger(r.status) || r.status < 100 || r.status > 599 : r.status !== null) throw Error('INVALID');
          if (r.durationMs !== null && integer(r.durationMs) > 86_400_000) throw Error('INVALID');
          return { at: r.at === null ? null : time(r.at), requestId: r.requestId, method: literal(r.method, methods), route: literal(r.route, routes), status: r.status, outcome, durationMs: r.durationMs };
        }), hasMore: bool(d.hasMore), retained: integer(d.retained), truncated: bool(d.truncated), dropped: integer(d.dropped), unmeasuredTime: integer(d.unmeasuredTime) };
        if (data.retained > 200 || data.requests.length > data.retained || data.truncated !== (data.dropped > 0)) throw Error('INVALID');
      } else if (name === 'events') {
        if (d.stateScope !== 'current-task-state' || d.taskCapturedAt !== capturedAt) throw Error('INVALID');
        data = { events: list(d.events, state.eventLimit).map(r => { if (r.taskRef !== null && (typeof r.taskRef !== 'string' || !/^task_[a-f0-9]{12}$/.test(r.taskRef))) throw Error('INVALID');
          return { at: time(r.at), taskRef: r.taskRef, event: literal(r.event, eventLabels), reason: literal(r.reason, reasonLabels), policy: literal(r.policy, policy), payment: literal(r.payment, payment), delivery: literal(r.delivery, delivery) };
        }), hasMore: bool(d.hasMore) };
      }
      return { status: 'ready', capturedAt, data };
    } catch { return { status: 'unavailable', code: 'INVALID_SOURCE' }; }
  }
  const isReady = name => state.sources[name]?.status === 'ready';
  function sourceCopy(source) { return copy(source?.code === 'ADMIN_SOURCE_TIMEOUT' ? 'admin.sourceTimeout' : source?.code === 'ADMIN_SOURCE_UNSUPPORTED' ? 'admin.sourceUnsupported' : source?.code === 'INVALID_SOURCE' ? 'admin.invalidSource' : 'admin.sourceUnavailable'); }
  function caption(node, name) {
    const source = state.sources[name];
    put(node, source?.status === 'ready' ? () => copy('admin.source', { scope: copy(scopeLabels[name]), time: date(source.capturedAt) }) + (name === 'runtime' && source.data.countersCapped ? ' · ' + copy('admin.countersCapped') : '') : sourceCopy(source));
    if (source?.status === 'ready') node.setAttribute('title', source.capturedAt); else node.removeAttribute('title');
  }
  const empty = (node, value) => node.replaceChildren(el('p', value, 'admin-empty'));
  function clearData() {
    state.dataEpoch++; state.sources = {}; $('admin-data').hidden = true;
    for (const id of ['admin-status', 'admin-metrics-source', 'admin-metrics', 'admin-runtime-source', 'admin-traffic', 'admin-traffic-coverage', 'admin-tasks-source', 'admin-payment-chart',
      'admin-payment-legend', 'admin-other-states', 'admin-latency', 'admin-usage-source', 'admin-usage', 'admin-executions-source', 'admin-executions',
      'admin-requests-source', 'admin-request-rows', 'admin-requests-note', 'admin-events-source', 'admin-event-rows', 'admin-events-note']) {
      $(id).replaceChildren(); $(id).removeAttribute('title');
    }
    for (const id of ['admin-request-count', 'admin-event-count']) put($(id), '—');
    $('admin-more-requests').hidden = true; $('admin-more-events').hidden = true;
  }
  function cancel() { state.read++; for (const controller of state.controllers) controller.abort(); state.controllers.clear(); state.busy = false; }
  function gate(kind) {
    $('admin-access').hidden = false; $('admin-data').hidden = true;
    const title = kind === 'guest' ? 'admin.guestTitle' : kind === 'denied' ? 'admin.deniedTitle' : kind === 'unavailable' ? 'admin.unavailableTitle' : 'admin.checkingTitle';
    const text = kind === 'guest' ? 'admin.guestCopy' : kind === 'denied' ? 'admin.deniedCopy' : kind === 'unavailable' ? 'admin.accessUnavailable' : 'admin.checkingCopy';
    put($('admin-access-title'), copy(title)); put($('admin-access-copy'), copy(text));
    $('admin-retry-access').hidden = kind !== 'unavailable'; $('admin-retry-access').disabled = state.busy;
  }
  function expired() { return state.role === 'allowed' && Date.now() >= state.expires; }
  function expireRole() { cancel(); clearData(); state.role = 'unknown'; state.expires = 0; $('admin-open').hidden = true; if (state.active) gate(state.wallet ? 'unavailable' : 'guest'); }
  function armExpiry() { clearTimeout(state.expiryTimer); state.expiryTimer = setTimeout(() => { if (expired()) expireRole(); else if (state.role === 'allowed') armExpiry(); }, Math.min(2_147_483_647, Math.max(1, state.expires - Date.now()))); }
  const current = lease => lease.epoch === state.epoch && lease.read === state.read && lease.wallet === state.wallet && lease.generation === state.generation;
  async function api(path, lease) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15_000); state.controllers.add(controller);
    try {
      const response = await fetch(path, { method: 'GET', credentials: 'same-origin', redirect: 'error', headers: { Accept: 'application/json' }, signal: controller.signal });
      const text = await response.text(); if (!current(lease)) throw { stale: true };
      if (text.length > 400_000) throw { invalid: true };
      if (response.status === 401 || response.status === 403) throw { status: response.status };
      let value; try { value = JSON.parse(text); } catch { throw { invalid: true }; }
      if (!response.ok) throw { status: response.status };
      return value;
    } catch (error) { if (!current(lease)) throw { stale: true }; throw error; }
    finally { clearTimeout(timer); state.controllers.delete(controller); }
  }
  function denied(error, lease) {
    if (!current(lease)) return;
    const wallet = state.wallet; cancel(); clearData(); state.role = error.status === 403 ? 'denied' : 'unknown'; state.expires = 0;
    clearTimeout(state.expiryTimer); $('admin-open').hidden = true;
    if (state.active) gate(error.status === 403 ? 'denied' : 'unavailable');
    if (error.status === 401) window.dispatchEvent(new CustomEvent('floww:session-expired', { detail: { wallet } }));
  }
  function applySection() {
    for (const node of document.querySelectorAll('[data-admin-route]')) {
      if (node.dataset.adminRoute === state.section) node.setAttribute('aria-current', 'page'); else node.removeAttribute('aria-current');
    }
    for (const node of document.querySelectorAll('[data-admin-section]')) node.hidden = node.dataset.adminSection !== state.section && !(state.section === 'overview' && node.dataset.adminSection === 'requests');
  }
  async function load({ data = state.active, focus = false } = {}) {
    cancel(); if (data) clearData();
    if (!state.ready || !state.wallet) { if (state.active) gate(state.ready ? 'guest' : 'checking'); return; }
    const lease = { epoch: state.epoch, read: state.read, wallet: state.wallet, generation: state.generation };
    state.busy = true; if (data) gate('checking'); $('admin-refresh').disabled = true; $('admin-window').disabled = true;
    try {
      const access = await api('/api/admin/access', lease);
      if (access?.role !== 'ADMIN_READ' || Date.parse(time(access.expiresAt)) <= Date.now()) throw { invalid: true };
      if (!current(lease)) return;
      state.role = 'allowed'; state.expires = Date.parse(access.expiresAt); $('admin-open').hidden = false; armExpiry();
      if (!data || !state.active) return;
      const names = state.section === 'overview' ? ['overview', 'requests'] : [state.section];
      const values = await Promise.all(names.map(async name => {
        try { return [name, await api('/api/admin/' + name + (name === 'requests' ? '?limit=' + state.requestLimit : name === 'events' ? '?limit=' + state.eventLimit : ''), lease)]; }
        catch (error) { if (error.stale || error.status === 401 || error.status === 403) throw error; return [name, null]; }
      }));
      if (!current(lease) || !state.active) return;
      if (expired()) { expireRole(); return; }
      for (const [name, value] of values) {
        if (name === 'overview') {
          let valid = value?.version === 'admin-read/v1';
          try { time(value?.generatedAt); } catch { valid = false; }
          for (const key of ['runtime', 'tasks', 'usage', 'executions']) state.sources[key] = valid ? project(key, value.sources?.[key]) : unavailable();
        } else state.sources[name] = value ? project(name, value) : unavailable();
      }
      $('admin-access').hidden = true; $('admin-data').hidden = false; render(); put($('admin-status'), copy(Object.values(state.sources).some(s => s.status !== 'ready') ? 'admin.partialLoad' : 'admin.loaded'));
      if (focus) {
        const node = $(state.section === 'overview' ? 'admin-attention-title' : state.section === 'requests' ? 'admin-requests-title' : 'admin-events-title');
        node.setAttribute('tabindex', '-1'); node.focus({ preventScroll: true }); node.scrollIntoView({ block: 'start', behavior: 'instant' });
      }
    } catch (error) { if (!error.stale && current(lease)) denied(error, lease); }
    finally { if (current(lease)) { state.busy = false; $('admin-refresh').disabled = false; $('admin-retry-access').disabled = false; $('admin-window').disabled = false; $('admin-more-requests').disabled = false; $('admin-more-events').disabled = false; } }
  }
  function stateLabel(kind, value) { return copy(value === 'PENDING' && kind === 'payment' ? 'admin.paymentPending' : value === 'PENDING' && kind === 'delivery' ? 'admin.deliveryPending' : statusKeys[value] ?? 'admin.other'); }
  function renderMetrics() {
    caption($('admin-metrics-source'), 'tasks');
    const node = $('admin-metrics'), source = state.sources.tasks, d = source?.data;
    node.replaceChildren(...[['admin.saved', d?.total, 'admin.savedHelp'], ['admin.uncertain', d?.attention.unresolvedPayments, 'admin.uncertainHelp'],
      ['admin.undelivered', d?.attention.confirmedUndelivered, 'admin.undeliveredHelp'], ['admin.noReport', d?.attention.deliveredWithoutReport, 'admin.noReportHelp']]
      .map(([label, value, note]) => { const card = el('div', undefined, 'admin-metric'); card.append(el('span', copy(label)), el('strong', source?.status === 'ready' ? count(value) : '—'), el('p', source?.status === 'ready' ? copy(note) : sourceCopy(source))); return card; }));
  }
  function renderTraffic() {
    caption($('admin-runtime-source'), 'runtime'); const node = $('admin-traffic'), source = state.sources.runtime; node.replaceChildren();
    if (!isReady('runtime')) { empty(node, sourceCopy(source)); put($('admin-traffic-coverage'), ''); return; }
    const d = source.data, minutes = $('admin-window').value === '60' ? 60 : 15;
    const lastMinute = Math.floor(Date.parse(d.minuteWindowThrough) / 60_000) * 60_000;
    const rows = d.minuteBuckets.filter(r => Date.parse(r.minute) >= lastMinute - (minutes - 1) * 60_000);
    const from = new Date(Math.max(Date.parse(d.minuteWindowFrom), Date.parse(rows[0].minute))).toISOString();
    put($('admin-traffic-coverage'), copy('admin.coverage', { from: date(from), through: date(d.minuteWindowThrough) }));
    const chart = svg('svg', { viewBox: '0 0 620 230', role: 'img' });
    locale.attr(chart, 'aria-label', copy('admin.chartSummary', { count: count(sum(rows.map(r => sum([r.completed, r.incomplete])))), minutes: rows.length }), () => state.dataEpoch);
    const maximum = Math.ceil(Math.max(1, ...rows.map(r => r.completed + r.incomplete)) / 3) * 3;
    for (let i = 0; i < 4; i++) {
      const y = 185 - i * 50; chart.append(svg('line', { x1: 42, x2: 612, y1: y, y2: y, class: 'admin-grid-line' }));
      const label = svg('text', { x: 34, y: y + 4, 'text-anchor': 'end', class: 'admin-tick' }); put(label, count(Math.round(maximum * i / 3))); chart.append(label);
    }
    const stride = 564 / Math.max(1, rows.length), width = Math.min(34, stride * .66);
    rows.forEach((row, i) => {
      const x = 48 + i * stride + (stride - width) / 2, completedHeight = row.completed / maximum * 150, incompleteHeight = row.incomplete / maximum * 150;
      const bar = svg('g', { 'data-minute': row.minute });
      const title = svg('title'); put(title, () => locale.date(row.minute) + ' · ' + copy('admin.httpCompleted') + ': ' + row.completed + ' · ' + copy('admin.httpIncomplete') + ': ' + row.incomplete); bar.append(title);
      if (completedHeight) bar.append(svg('rect', { x, y: 185 - completedHeight, width, height: completedHeight, rx: 3, fill: '#506eff' }));
      if (incompleteHeight) bar.append(svg('rect', { x, y: 185 - completedHeight - incompleteHeight, width, height: incompleteHeight, rx: 3, fill: '#d74c78' }));
      chart.append(bar);
      if (i === 0 || i === rows.length - 1 || (rows.length > 5 && i === Math.floor(rows.length / 2))) {
        const tick = svg('text', { x: x + width / 2, y: 209, 'text-anchor': 'middle', class: 'admin-tick' }); put(tick, row.minute.slice(11, 16) + ' UTC'); chart.append(tick);
      }
    });
    node.append(chart);
    const details = el('details', undefined, 'admin-chart-values'), table = el('table', undefined, 'admin-table'), head = el('thead'), header = el('tr'), body = el('tbody');
    details.append(el('summary', copy('admin.minuteValues')));
    for (const key of ['admin.time', 'admin.httpCompleted', 'admin.httpIncomplete']) { const th = el('th', copy(key)); th.setAttribute('scope', 'col'); header.append(th); }
    head.append(header); table.append(el('caption', copy('admin.minuteValues'), 'sr-only'), head);
    for (const row of rows) { const tr = el('tr'); tr.append(timeCell(row.minute), el('td', count(row.completed)), el('td', count(row.incomplete))); body.append(tr); }
    table.append(body); const wrap = el('div', undefined, 'admin-table-wrap'); wrap.setAttribute('tabindex', '0'); wrap.append(table); details.append(wrap); node.append(details);
    const notes = el('p', copy('admin.processTotals', { completed: count(d.completed), incomplete: count(d.incomplete) }), 'admin-bar-notes'); node.append(notes);
    if (!rows.some(r => r.completed || r.incomplete)) node.append(el('p', copy('admin.noTraffic'), 'admin-bar-notes'));
  }
  function legend(kind, values, keys) {
    const dl = el('dl', undefined, 'admin-state-legend');
    for (const [i, key] of keys.entries()) {
      const row = el('div'), dt = el('dt'), dot = svg('svg', { width: 9, height: 10, viewBox: '0 0 9 10', class: 'admin-swatch', 'aria-hidden': 'true' });
      dot.append(svg('rect', { x: 0, y: 2, width: 8, height: 8, rx: 2, fill: palette[i] }));
      dt.append(dot, el('span', stateLabel(kind, key))); row.append(dt, el('dd', count(values[key]))); dl.append(row);
    }
    return dl;
  }
  function renderTasks() {
    caption($('admin-tasks-source'), 'tasks'); renderMetrics(); const source = state.sources.tasks;
    $('admin-payment-chart').replaceChildren(); $('admin-payment-legend').replaceChildren(); $('admin-other-states').replaceChildren();
    if (!isReady('tasks')) { empty($('admin-payment-chart'), sourceCopy(source)); return; }
    const d = source.data, chart = svg('svg', { viewBox: '0 0 150 150', role: 'img' }), circumference = 2 * Math.PI * 57;
    locale.attr(chart, 'aria-label', copy('admin.distributionSummary', { total: count(d.total) }), () => state.dataEpoch);
    chart.append(svg('circle', { cx: 75, cy: 75, r: 57, fill: 'none', stroke: '#edf0f7', 'stroke-width': 17 })); let offset = 0;
    if (d.total) payment.forEach((key, i) => { if (!d.payment[key]) return; const length = circumference * d.payment[key] / d.total;
      chart.append(svg('circle', { cx: 75, cy: 75, r: 57, fill: 'none', stroke: palette[i], 'stroke-width': 17, 'stroke-dasharray': length + ' ' + circumference,
        'stroke-dashoffset': -offset, transform: 'rotate(-90 75 75)', 'data-count': d.payment[key] })); offset += length; });
    const total = svg('text', { x: 75, y: 80, 'text-anchor': 'middle', fill: '#18243b', 'font-size': 26, 'font-weight': 650 }); put(total, count(d.total)); chart.append(total); $('admin-payment-chart').append(chart);
    if (!d.total) $('admin-payment-chart').append(el('p', copy('admin.noTasks'), 'admin-bar-notes'));
    $('admin-payment-legend').replaceChildren(...legend('payment', d.payment, payment).children);
    for (const [kind, keys] of [['policy', policy], ['delivery', delivery]]) { const group = el('div'); group.append(el('h3', copy('admin.' + kind)), legend(kind, d[kind], keys)); $('admin-other-states').append(group); }
    if (d.coverage.invalidStateTasks || d.coverage.invalidReportShapes) $('admin-other-states').append(el('p', copy('admin.invalidRecords', { states: count(d.coverage.invalidStateTasks), reports: count(d.coverage.invalidReportShapes) }), 'admin-quality-note'));
  }
  function bars(node, rows) {
    const group = el('div', undefined, 'admin-bars'), maximum = Math.max(1, ...rows.map(r => sum(r.values)));
    for (const row of rows) {
      const line = el('div', undefined, 'admin-bar-row'), graphic = svg('svg', { viewBox: '0 0 120 10', width: '100%', height: 10, 'aria-hidden': 'true' });
      graphic.append(svg('rect', { x: 0, y: 1, width: 120, height: 8, rx: 4, fill: '#edf0f7' })); let x = 0;
      row.values.forEach((value, i) => { const width = value / maximum * 120; if (width) graphic.append(svg('rect', { x, y: 1, width, height: 8, fill: i ? '#d74c78' : '#647eff' })); x += width; });
      line.append(el('span', row.label), graphic, el('strong', () => row.values.map(formatCount).join(' / '))); group.append(line);
    }
    node.append(group);
  }
  function renderOperating() {
    const latency = $('admin-latency'); latency.replaceChildren();
    if (isReady('runtime')) {
      const d = state.sources.runtime.data;
      bars(latency, d.latencyBuckets.map((r, i, all) => ({ label: r.upperMs === null ? '>60,000 ms' : (i ? '>' + all[i - 1].upperMs + '–' : '0–') + r.upperMs + ' ms', values: [r.count] })));
      latency.append(el('p', copy('admin.unmeasured', { count: count(d.unmeasuredLatency), suppressed: count(d.suppressed) }), 'admin-bar-notes'));
      latency.append(el('p', copy('admin.clockNote', { count: count(d.unmeasuredTime), regressions: count(d.clockRegressions) }), 'admin-bar-notes'));
      if (d.countersCapped) latency.append(el('p', copy('admin.countersCapped'), 'admin-quality-note'));
      const checks = el('div', undefined, 'admin-runtime-checks'), values = el('ul'); checks.append(el('h4', copy('admin.capabilities')));
      for (const [key, label] of [['workspaceAdapterReady', 'admin.workspaceCapability'], ['reportAdapterReady', 'admin.reportCapability'], ['modelConfigured', 'admin.modelConfigured'], ['paymentEnabled', 'admin.paymentEnabled']]) {
        const li = el('li'); li.append(el('span', copy(label)), el('strong', copy(d.capabilities[key] ? 'admin.true' : 'admin.false'))); values.append(li);
      }
      checks.append(values, el('p', copy('admin.noProviderProof'))); if (d.draining) checks.append(el('p', copy('admin.draining'))); latency.append(checks);
    } else empty(latency, sourceCopy(state.sources.runtime));
    for (const name of ['usage', 'executions']) {
      const node = $('admin-' + name); node.replaceChildren(); caption($('admin-' + name + '-source'), name);
      if (!isReady(name)) { empty(node, sourceCopy(state.sources[name])); continue; }
      const d = state.sources[name].data;
      bars(node, d.days.map(r => ({ label: r.day.slice(5) + ' UTC', values: name === 'usage' ? [r.admittedRoleCalls] : [r.heldExecutions, r.observedExecutions] })));
      node.append(el('p', name === 'usage' ? copy('admin.dailyLimit', { limit: count(d.limitPerDay) }) : () => copy('admin.held') + ' / ' + copy('admin.observed'), 'admin-bar-notes'));
    }
  }
  function tableEmpty(node, span, value) { const tr = el('tr'), td = el('td', value, 'admin-empty-cell'); td.setAttribute('colspan', span); tr.append(td); node.append(tr); }
  function timeCell(value) { const td = el('td'); if (value === null) td.append(el('span', copy('admin.durationMissing'))); else { const t = el('time', date(value)); t.setAttribute('datetime', value); t.setAttribute('title', value); td.append(t); } return td; }
  function renderLog(name) {
    const events = name === 'events', source = state.sources[name], node = $(events ? 'admin-event-rows' : 'admin-request-rows'); node.replaceChildren();
    caption($('admin-' + name + '-source'), name); const note = $('admin-' + name + '-note'), more = $('admin-more-' + name);
    more.hidden = true; more.disabled = state.busy;
    put($(events ? 'admin-event-count' : 'admin-request-count'), source?.status === 'ready' ? copy('admin.requestCount', { count: count(source.data[name].length) }) : '—');
    if (!isReady(name)) { tableEmpty(node, events ? 6 : 5, sourceCopy(source)); put(note, ''); return; }
    const d = source.data;
    for (const row of d[name]) {
      const tr = el('tr'); tr.append(timeCell(row.at));
      if (events) {
        const reference = el('td'); reference.append(el('code', row.taskRef ?? copy('admin.unknown')));
        const event = el('td'); event.append(el('code', row.event), el('small', row.reason));
        tr.append(reference, event, el('td', stateLabel('policy', row.policy)), el('td', stateLabel('payment', row.payment)), el('td', stateLabel('delivery', row.delivery)));
      } else {
        const route = el('td'); route.append(el('code', row.method + ' · ' + row.route));
        tr.append(route, el('td', row.status === null ? copy('admin.httpIncomplete') : String(row.status)), el('td', row.durationMs === null ? copy('admin.durationMissing') : row.durationMs + ' ms'), el('td'));
        tr.children[4].append(el('code', row.requestId ?? copy('admin.durationMissing')));
      }
      node.append(tr);
    }
    if (!d[name].length) tableEmpty(node, events ? 6 : 5, copy(events ? 'admin.noEvents' : 'admin.noRequests'));
    put(note, () => [copy(events ? 'admin.eventRetention' : 'admin.requestRetention'), !events && d.truncated ? copy('admin.logTruncated', { count: count(d.dropped) }) : '',
      !events && d.unmeasuredTime ? copy('admin.clockNote', { count: count(d.unmeasuredTime), regressions: '—' }) : '',
      d.hasMore ? copy((events ? state.eventLimit < 50 : state.requestLimit < 100) ? 'admin.moreAvailable' : 'admin.atLimit') : ''].filter(Boolean).join(' '));
    more.hidden = !d.hasMore || (events ? state.eventLimit >= 50 : state.requestLimit >= 100);
  }
  function render() {
    applySection();
    if (state.section === 'overview') { renderTraffic(); renderTasks(); renderOperating(); renderLog('requests'); }
    else renderLog(state.section);
  }
  $('admin-refresh').addEventListener('click', () => { if (!state.busy) return load(); });
  $('admin-retry-access').addEventListener('click', () => { if (!state.busy) return load(); });
  $('admin-window').addEventListener('change', () => { if (expired()) { expireRole(); return; } if (state.active && !state.busy && state.role === 'allowed') renderTraffic(); });
  $('admin-more-requests').addEventListener('click', () => { if (!state.busy && state.active) { state.requestLimit = Math.min(100, state.requestLimit * 2); return load(); } });
  $('admin-more-events').addEventListener('click', () => { if (!state.busy && state.active) { state.eventLimit = 50; return load(); } });
  window.addEventListener('floww:workspace-view', event => {
    const active = event.detail?.view === 'admin', section = ['requests', 'events'].includes(event.detail?.section) ? event.detail.section : 'overview';
    if (active === state.active && (!active || section === state.section)) return;
    cancel(); clearData(); state.active = active; state.section = section; applySection();
    if (active) load({ data: true, focus: true });
  });
  window.addEventListener('floww:session', event => {
    const wallet = event.detail?.wallet ?? null, generation = Number.isInteger(event.detail?.generation) ? event.detail.generation : null, ready = event.detail?.initializing !== true;
    const changed = wallet !== state.wallet || (state.generation !== null && generation !== null && generation !== state.generation);
    const becameReady = ready && !state.ready; state.ready = ready;
    if (changed) { cancel(); clearData(); clearTimeout(state.expiryTimer); state.epoch++; state.wallet = wallet; state.generation = generation; state.role = 'unknown'; state.expires = 0; state.requestLimit = 25; state.eventLimit = 25; $('admin-open').hidden = true; }
    else state.generation = generation;
    if ((changed || becameReady) && ready && wallet) load({ data: state.active });
    else if (state.active && (!wallet || !ready)) gate(ready ? 'guest' : 'checking');
    if (expired()) expireRole();
  });
  window.addEventListener('focus', () => { if (expired()) expireRole(); });
  window.addEventListener('pagehide', () => { cancel(); clearData(); if (state.active) gate(state.wallet ? 'unavailable' : 'guest'); });
  const initial = /^#\/admin(?:\/(requests|events))?$/.exec(window.location.hash);
  if (initial?.[1]) state.section = initial[1];
  applySection(); clearData(); if (state.active) gate('checking');
  window.dispatchEvent(new CustomEvent('floww:session-refresh'));
})();
