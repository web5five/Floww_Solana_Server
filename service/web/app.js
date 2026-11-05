(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const state = { wallet: null, health: null, tasks: [], activeId: null, initializing: true, busy: false, busyLabel: '', approvalHash: null, provider: null };
  const policyNames = { PENDING: '승인 대기', ALLOW: '승인됨', DENY: '승인되지 않음' };
  const paymentNames = { NOT_STARTED: '시작 전', SIGNING: '서명 준비 중', PENDING: '확인 중', UNKNOWN: '확인 필요', CONFIRMED: '결제 확인됨', FAILED: '거래 실패' };
  const deliveryNames = { NOT_STARTED: '시작 전', PENDING: '전달 확인 중', COMPLETED: '전달 완료', FAILED: '전달 확인 필요' };
  const eventNames = { TASK_CREATED: '자료 요청 생성', QUOTE_READY: '결제 조건 확인', APPROVED: '지출 조건 승인',
    POLICY_DENIED: '승인 조건 확인 필요', APPROVAL_REVOKED: '승인 취소', EXECUTION_CLAIMED: '승인 확인 및 서명 준비',
    PAYMENT_SUBMITTED: '결제 요청 전달', PAYMENT_OBSERVED: '결제·자료 상태 확인', PAYMENT_RECONCILED: '원래 거래 상태 재확인',
    REPORT_READY: '분석 결과 준비 완료', REPORT_REJECTED: '자료 검증 확인 필요', OPERATION_STOPPED: '실행 상태 확인 필요', RECOVERY_REQUIRED: '이전 실행 상태 재확인 필요' };
  const errors = {
    AUTHENTICATION_REQUIRED: '로그인이 필요합니다. 지갑을 다시 연결해 주세요.',
    WALLET_NOT_AVAILABLE: 'Phantom 지갑을 찾지 못했습니다. 지갑이 연결된 브라우저에서 열어 주세요.',
    WALLET_DECLINED: '지갑 승인을 취소했습니다. 준비되면 다시 연결해 주세요.',
    INVALID_WALLET: '유효한 Solana 지갑 주소를 입력해 주세요.', INVALID_TASK: '요청 목적과 지갑 주소를 확인해 주세요.',
    INVALID_ANALYTICS_SCOPE: '조회 기간은 현재 이전의 최대 7일로 설정해 주세요.', INVALID_REPORT_WINDOW: '조회 기간을 다시 확인해 주세요.',
    EXPLICIT_APPROVAL_REQUIRED: '결제 조건을 읽고 동의 항목을 선택해 주세요.',
    BUDGET_DENIED: '지출 한도가 결제 금액보다 작거나 서비스 한도를 넘었습니다.',
    APPROVAL_EXPIRED: '결제 조건이나 승인의 기한이 지났습니다. 새 조건을 확인하고 다시 승인해 주세요.',
    QUOTE_REQUIRED: '먼저 결제 조건을 확인해 주세요.', PAYER_CHANGED: '서비스 결제 지갑이 바뀌었습니다. 새 조건을 확인해 주세요.',
    PAYMENT_NOT_READY: 'Devnet 결제 설정을 준비 중입니다. 설정이 완료된 뒤 승인할 수 있습니다.',
    SIGNING_NOT_READY: 'Devnet 결제 설정이 준비되지 않았습니다. 현재 요청은 실행되지 않았습니다.',
    MERCHANT_NOT_CONFIGURED: '자료 제공 서비스의 연결을 준비 중입니다.',
    FACILITATOR_UNAVAILABLE: '결제 검증 서비스에 연결하지 못했습니다. 현재 상태를 확인한 뒤 다시 시도해 주세요.',
    QUOTE_UNAVAILABLE: '자료의 결제 조건을 가져오지 못했습니다. 잠시 후 다시 확인해 주세요.',
    TASK_BUSY: '이 요청을 처리하고 있습니다. 상태가 갱신될 때까지 기다려 주세요.',
    TASK_CHANGED: '요청 상태가 바뀌었습니다. 최신 상태를 확인해 주세요.',
    EXECUTION_ALREADY_CLAIMED: '이미 시작한 실행입니다. 원래 결제의 상태를 확인해 주세요.',
    RATE_LIMITED: '요청이 잠시 많아졌습니다. 잠시 후 다시 시도해 주세요.',
    TASK_LIMIT_REACHED: '현재 보관할 수 있는 요청 수에 도달했습니다.',
    INVALID_CHALLENGE: '로그인 확인이 만료됐습니다. 지갑을 다시 연결해 주세요.',
    INVALID_SIGNATURE: '지갑 서명을 확인하지 못했습니다. 다시 로그인해 주세요.',
    RESPONSE_UNAVAILABLE: '응답을 확인하지 못했습니다. 실행을 반복하기 전에 요청의 현재 상태를 확인해 주세요.',
    SERVICE_UNAVAILABLE: '서비스에 연결하지 못했습니다. 잠시 후 상태를 다시 확인해 주세요.',
  };
  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = String(text);
    if (className) node.className = className;
    return node;
  };
  const active = () => state.tasks.find(task => task.id === state.activeId) ?? null;
  const short = (value, count = 6) => typeof value === 'string' && value.length > count * 2 + 3 ? value.slice(0, count) + '…' + value.slice(-count) : value || '설정 대기';
  const dateText = value => Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('ko-KR', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value)) : '시간 확인 필요';
  const localDate = value => {
    const date = new Date(value);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
  };
  const liveQuote = task => task?.quote && Date.parse(task.quote.expiresAt) > Date.now();
  const liveApproval = task => task?.approval && !task.approval.revoked && Date.parse(task.approval.expiresAt) > Date.now();

  function notice(code) {
    $('notice-text').textContent = errors[code] ?? '요청을 처리하지 못했습니다. 현재 상태를 확인한 뒤 다시 진행해 주세요.';
    $('notice').hidden = false;
  }
  function clearNotice() { $('notice').hidden = true; $('notice-text').textContent = ''; }
  function announce(text) { $('live-status').textContent = text; }

  async function api(path, method = 'GET', body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await fetch(path, { method, credentials: 'same-origin', redirect: 'error',
        headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal,
      });
      if (response.status === 204) return null;
      const text = await response.text();
      if (text.length > 2_000_000) throw { code: 'RESPONSE_UNAVAILABLE' };
      let result;
      try { result = JSON.parse(text); } catch { throw { code: 'RESPONSE_UNAVAILABLE' }; }
      if (!response.ok) throw { code: result?.error?.code ?? 'SERVICE_UNAVAILABLE', status: response.status };
      return result;
    } catch (error) {
      if (error?.code) throw error;
      throw { code: error?.name === 'AbortError' ? 'RESPONSE_UNAVAILABLE' : 'SERVICE_UNAVAILABLE' };
    } finally { clearTimeout(timer); }
  }

  function clearSession() {
    state.wallet = null; state.tasks = []; state.activeId = null; state.approvalHash = null;
    render();
  }
  async function perform(label, action) {
    if (state.busy || state.initializing) return;
    clearNotice(); state.busy = true; state.busyLabel = label;
    updateControls();
    try { await action(); announce(label.replace(/\s중$/, '') + ' 완료'); }
    catch (error) {
      if (error?.status === 401) clearSession();
      notice(error?.code);
    } finally { state.busy = false; state.busyLabel = ''; render(); }
  }

  function taskSummary(task) {
    if (task.result?.answer) return { text: '분석 완료', className: 'success' };
    if (task.payment === 'CONFIRMED') return { text: task.delivery === 'COMPLETED' ? '자료 전달됨' : '자료 복구 필요', className: task.delivery === 'COMPLETED' ? 'success' : 'warning' };
    if (task.payment === 'FAILED') return { text: '거래 실패', className: 'error' };
    if (task.payment === 'UNKNOWN') return { text: '거래 확인 필요', className: 'warning' };
    if (['SIGNING', 'PENDING'].includes(task.payment)) return { text: '실행 중', className: '' };
    if (task.policy === 'ALLOW' && liveApproval(task)) return { text: '실행 승인됨', className: 'success' };
    if (task.quote && !liveQuote(task)) return { text: '조건 재확인 필요', className: 'warning' };
    if (task.quote) return { text: '조건 승인 대기', className: '' };
    return { text: '가격 확인 대기', className: '' };
  }
  function guidance(task) {
    if (task.result?.answer) return '자료와 거래 근거를 확인했습니다. 아래에서 자산별 이체 결과를 살펴보세요.';
    if (task.payment === 'UNKNOWN') return '결제 결과가 아직 확정되지 않았습니다. 새 결제를 만들지 않고 원래 거래의 상태를 확인합니다.';
    if (task.payment === 'CONFIRMED' && task.delivery !== 'COMPLETED') return '결제는 확인됐습니다. 같은 결제를 사용해 자료 전달을 다시 확인할 수 있습니다.';
    if (task.payment === 'CONFIRMED') return '자료가 전달됐습니다. 내용 검증과 분석 결과의 상태를 확인해 주세요.';
    if (task.payment === 'FAILED') return '거래 실패가 확인됐습니다. 실행 기록과 거래 상태를 검토해 주세요.';
    if (['SIGNING', 'PENDING'].includes(task.payment)) return '승인된 요청을 처리하고 있습니다. 같은 결제를 다시 실행하지 않고 상태를 확인합니다.';
    if (task.quote && !liveQuote(task)) return '결제 조건의 유효 시간이 지났습니다. 최신 조건을 확인한 뒤 다시 승인해 주세요.';
    if (task.policy === 'ALLOW' && liveApproval(task)) return '승인한 조건으로 실행할 준비가 됐습니다. 아래 실행 버튼을 누르면 Devnet 결제가 시작됩니다.';
    if (task.quote) return '수신자와 토큰, 금액을 확인해 주세요. 승인만으로 결제가 시작되지는 않습니다.';
    return '실제 자료 제공 서비스에서 결제 조건을 가져온 뒤, 승인 여부를 결정할 수 있습니다.';
  }

  function renderHealth() {
    const health = state.health;
    $('health-status').textContent = health ? health.ready ? 'Devnet 결제 설정 준비됨' : 'Devnet 실행 설정 준비 중' : '설정 상태 확인 중';
    $('health-detail').textContent = health ? health.ready ? '각 결제 직전에 승인과 네트워크를 다시 확인합니다.' : '요청을 보관하고, 연결 준비가 끝나면 조건을 확인할 수 있습니다.' : '현재 Devnet 환경을 확인하고 있습니다.';
  }
  function renderHistory() {
    $('task-count').textContent = String(state.tasks.length);
    $('history-empty').hidden = state.tasks.length > 0;
    $('task-list').replaceChildren(...state.tasks.map(task => {
      const button = element('button', null, 'task-item' + (task.id === state.activeId ? ' selected' : ''));
      button.type = 'button'; button.disabled = state.busy;
      button.setAttribute('aria-pressed', String(task.id === state.activeId));
      button.append(element('span', task.purpose, 'task-item-title'));
      const meta = element('span', null, 'task-item-meta');
      meta.append(element('span', dateText(task.createdAt)), element('span', taskSummary(task).text, 'task-item-state'));
      button.append(meta);
      button.addEventListener('click', () => perform('요청 상태 확인 중', async () => {
        const selected = await api('/api/tasks/' + encodeURIComponent(task.id));
        if (!state.wallet) return;
        acceptTask(selected); state.activeId = task.id;
      }));
      return button;
    }));
  }
  function amountDisplay(amount, decimals) {
    if (typeof amount !== 'string' || !/^[0-9]{1,78}$/.test(amount) || !Number.isInteger(decimals) || decimals < 0 || decimals > 18) return '금액 확인 필요';
    if (decimals === 0) return amount;
    const padded = amount.padStart(decimals + 1, '0');
    const fraction = padded.slice(-decimals).replace(/0+$/, '');
    return padded.slice(0, -decimals) + (fraction ? '.' + fraction : '');
  }
  function quoteDetail(label, value) {
    return [element('dt', label), element('dd', value || '설정 대기')];
  }
  function renderQuote(task) {
    const quote = task.quote;
    $('quote-summary').hidden = !quote;
    $('proposal-note').hidden = !task.proposal?.explanation;
    $('proposal-note').textContent = task.proposal?.explanation || '';
    if (!quote) { state.approvalHash = null; return; }
    $('quote-price').textContent = amountDisplay(quote.amountAtomic, quote.assetDecimals) + ' 토큰';
    $('quote-atomic').textContent = quote.amountAtomic + ' 기본 단위';
    $('quote-details').replaceChildren(...[
      ...quoteDetail('결제 지갑', quote.payer), ...quoteDetail('수신자', quote.recipient),
      ...quoteDetail('토큰 mint', quote.asset), ...quoteDetail('네트워크', 'Solana Devnet'),
      ...quoteDetail('조건 기한', dateText(quote.expiresAt)),
    ]);
    if (state.approvalHash !== quote.hash) {
      state.approvalHash = quote.hash;
      $('budget').value = quote.amountAtomic;
      $('approval-expiry').value = localDate(Math.min(Date.now() + 5 * 60_000, Date.parse(quote.expiresAt) - 1000));
      $('approval-ack').checked = false;
    }
    $('approval-expiry').max = localDate(quote.expiresAt);
    const approved = task.approval && !task.approval.revoked;
    $('approval-status').hidden = !approved;
    $('approval-status').textContent = approved ? '승인한 지출 한도 ' + task.approval.budgetAtomic + ' 기본 단위 · ' + dateText(task.approval.expiresAt) + '까지' : '';
  }
  function renderTimeline(task) {
    const events = Array.isArray(task.events) ? task.events : [];
    $('timeline').replaceChildren(...events.map(event => {
      const item = element('li');
      item.append(element('strong', eventNames[event.type] ?? '실행 상태 갱신'));
      const at = element('time', dateText(event.at));
      if (Number.isFinite(Date.parse(event.at))) at.dateTime = event.at;
      item.append(at); return item;
    }));
    const transaction = task.transaction;
    const safe = typeof transaction === 'string' && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(transaction);
    $('transaction-wrap').hidden = !safe;
    if (safe) {
      $('transaction-link').textContent = short(transaction, 12) + ' ↗';
      $('transaction-link').href = 'https://explorer.solana.com/tx/' + encodeURIComponent(transaction) + '?cluster=devnet';
    } else { $('transaction-link').removeAttribute('href'); $('transaction-link').textContent = ''; }
  }
  function renderResult(task) {
    const answer = task.result?.answer;
    $('result-empty').hidden = Boolean(answer);
    $('result-content').hidden = !answer;
    $('download-report').hidden = !answer || typeof task.result.markdown !== 'string' || !task.result.markdown;
    if (!answer) { $('result-content').replaceChildren(); return; }
    const pieces = [];
    if (answer.is_synthetic) pieces.push(element('p', '이 결과는 실제 네트워크에서 조회한 자료가 아닙니다.', 'report-notice'));
    pieces.push(element('p', answer.complete ? '명시된 자료 범위 안에서 집계했습니다.' : '조회 자료의 일부만 확인됐습니다. 반환된 이체를 기준으로 집계합니다.', 'report-notice' + (answer.complete ? ' good' : '')));
    pieces.push(element('p', answer.answer_text ?? '분석 내용이 준비됐습니다.', 'report-summary'));
    if (Array.isArray(answer.totals) && answer.totals.length) {
      pieces.push(element('h3', '자산별 이체', 'report-section-title'));
      for (const total of answer.totals) {
        const item = element('section', null, 'asset-total');
        const head = element('header');
        head.append(element('span', ({ in: '입금', out: '출금', self: '동일 지갑 이체' })[total.direction] ?? '이체'), element('span', String(total.transfer_count ?? 0) + '건'));
        item.append(head, element('strong', total.amount_display ?? ''), element('code', total.asset_ref ?? ''), element('code', String(total.amount_base_units ?? '') + ' 기본 단위'));
        pieces.push(item);
      }
    }
    for (const [title, values] of [['자료 출처', answer.source_refs], ['확인한 근거', answer.evidence_refs], ['조회 범위와 참고 사항', answer.limitations]]) {
      if (!Array.isArray(values) || !values.length) continue;
      const list = element('ul', null, 'report-list');
      list.append(...values.map(value => element('li', value)));
      pieces.push(element('h3', title, 'report-section-title'), list);
    }
    pieces.push(element('p', '이체 합계는 반환된 활동 내역이며 지갑 잔액이나 수익을 뜻하지 않습니다. 자료 시점: ' + dateText(answer.data_as_of), 'report-data-note'));
    $('result-content').replaceChildren(...pieces);
  }
  function renderSelection() {
    const task = active();
    $('selection-empty').hidden = Boolean(task); $('selection-content').hidden = !task;
    if (!task) return;
    $('execution-title').textContent = task.purpose;
    $('task-meta').textContent = short(task.wallet, 8) + ' · ' + dateText(task.windowStart) + ' – ' + dateText(task.windowEnd);
    const status = taskSummary(task);
    $('task-state').textContent = status.text; $('task-state').className = 'state-pill ' + status.className;
    $('policy-state').textContent = policyNames[task.policy] ?? '확인 필요';
    $('payment-state').textContent = paymentNames[task.payment] ?? '확인 필요';
    $('delivery-state').textContent = deliveryNames[task.delivery] ?? '확인 필요';
    $('task-guidance').textContent = guidance(task);
    renderQuote(task); renderTimeline(task); renderResult(task);
  }
  function updateControls() {
    const task = active(), authenticated = Boolean(state.wallet), busy = state.busy || state.initializing;
    $('connect-wallet').disabled = busy || authenticated;
    $('connect-wallet').textContent = authenticated ? short(state.wallet) : busy && state.busyLabel === '지갑 로그인 중' ? '로그인 중…' : '지갑 연결';
    $('connect-wallet').title = authenticated ? state.wallet : 'Phantom 지갑으로 로그인';
    $('logout').hidden = !authenticated; $('logout').disabled = busy;
    $('create-task').disabled = !authenticated || busy;
    $('refresh-tasks').disabled = !authenticated || busy;
    $('login-hint').hidden = authenticated;
    document.querySelectorAll('.task-item').forEach(button => { button.disabled = busy; });
    for (const input of document.querySelectorAll('form input,form textarea')) input.disabled = busy;
    $('action-status').textContent = busy ? state.busyLabel + '…' : '';
    if (!task) return;
    $('task-guidance').textContent = guidance(task);
    const status = taskSummary(task);
    $('task-state').textContent = status.text; $('task-state').className = 'state-pill ' + status.className;
    const notStarted = task.payment === 'NOT_STARTED';
    $('quote-task').hidden = !notStarted;
    $('quote-task').textContent = task.quote ? '결제 조건 다시 확인' : '결제 조건 확인';
    $('quote-task').disabled = busy || !authenticated;
    $('approval-form').hidden = !notStarted || !task.quote || (task.policy === 'ALLOW' && liveApproval(task));
    $('approve-task').disabled = busy || !authenticated || !liveQuote(task) || !state.health?.ready || !$('approval-ack').checked;
    $('execute-task').hidden = !notStarted || task.policy !== 'ALLOW';
    $('execute-task').disabled = busy || !authenticated || !liveQuote(task) || !liveApproval(task) || !state.health?.ready;
    $('revoke-task').hidden = !notStarted || !task.approval || task.approval.revoked;
    $('revoke-task').disabled = busy || !authenticated;
    $('reconcile-task').hidden = !['UNKNOWN', 'PENDING', 'SIGNING'].includes(task.payment);
    $('reconcile-task').disabled = busy || !authenticated;
    $('recover-task').hidden = task.payment !== 'CONFIRMED' || Boolean(task.result?.answer);
    $('recover-task').disabled = busy || !authenticated || Boolean(task.approval?.revoked);
    $('refresh-task').disabled = busy || !authenticated;
  }
  function render() { renderHealth(); renderHistory(); renderSelection(); updateControls(); }
  function acceptTask(task) {
    if (!task || typeof task.id !== 'string') throw { code: 'RESPONSE_UNAVAILABLE' };
    const index = state.tasks.findIndex(old => old.id === task.id);
    if (index < 0) state.tasks.unshift(task);
    else if (Number(task.revision) >= Number(state.tasks[index].revision)) state.tasks[index] = task;
  }
  async function loadTasks() {
    const result = await api('/api/tasks');
    state.tasks = Array.isArray(result.tasks) ? result.tasks : [];
    if (!state.tasks.some(task => task.id === state.activeId)) state.activeId = state.tasks[0]?.id ?? null;
  }
  async function selectedAction(action, body = {}) {
    const task = active();
    if (!task) return;
    const updated = await api('/api/tasks/' + encodeURIComponent(task.id) + '/' + action, 'POST', body);
    if (state.wallet) acceptTask(updated);
  }
  async function refreshSelected() {
    const id = state.activeId;
    if (!id) return;
    const updated = await api('/api/tasks/' + encodeURIComponent(id));
    if (state.wallet) acceptTask(updated);
  }

  $('dismiss-notice').addEventListener('click', clearNotice);
  $('connect-wallet').addEventListener('click', () => perform('지갑 로그인 중', async () => {
    const provider = window.phantom?.solana ?? window.solana;
    if (!provider?.isPhantom || typeof provider.connect !== 'function' || typeof provider.signMessage !== 'function') throw { code: 'WALLET_NOT_AVAILABLE' };
    let connection, signed;
    try { connection = await provider.connect(); }
    catch { throw { code: 'WALLET_DECLINED' }; }
    const wallet = connection.publicKey?.toString();
    if (!wallet) throw { code: 'INVALID_WALLET' };
    const challenge = await api('/api/auth/challenge', 'POST', { wallet });
    if (typeof challenge.message !== 'string' || typeof challenge.challengeId !== 'string') throw { code: 'RESPONSE_UNAVAILABLE' };
    try { signed = await provider.signMessage(new TextEncoder().encode(challenge.message), 'utf8'); }
    catch { throw { code: 'WALLET_DECLINED' }; }
    const bytes = signed.signature;
    if (!(bytes instanceof Uint8Array) || bytes.length !== 64) throw { code: 'INVALID_SIGNATURE' };
    const signature = btoa(String.fromCharCode(...bytes));
    const session = await api('/api/auth/verify', 'POST', { wallet, challengeId: challenge.challengeId, signature });
    state.wallet = session.wallet;
    if (!$('report-wallet').value.trim()) $('report-wallet').value = session.wallet;
    if (state.provider !== provider) {
      state.provider = provider;
      provider.on?.('accountChanged', () => {
        if (!state.wallet) return;
        clearSession();
        api('/api/auth/logout', 'POST', {}).catch(() => {});
        notice('AUTHENTICATION_REQUIRED');
      });
    }
    await loadTasks();
  }));
  $('logout').addEventListener('click', () => perform('로그아웃 중', async () => {
    await api('/api/auth/logout', 'POST', {}); clearSession();
  }));
  $('refresh-tasks').addEventListener('click', () => perform('요청 목록 확인 중', loadTasks));
  $('refresh-task').addEventListener('click', () => perform('실행 상태 확인 중', refreshSelected));
  $('quote-task').addEventListener('click', () => perform('결제 조건 확인 중', () => selectedAction('quote')));
  $('execute-task').addEventListener('click', () => perform('승인한 결제 실행 중', async () => {
    const task = active();
    if (!liveQuote(task) || !liveApproval(task)) throw { code: 'APPROVAL_EXPIRED' };
    await selectedAction('execute', { approvalId: task.approval.id });
  }));
  $('revoke-task').addEventListener('click', () => perform('승인 취소 중', () => selectedAction('revoke')));
  $('reconcile-task').addEventListener('click', () => perform('원래 결제 확인 중', () => selectedAction('reconcile')));
  $('recover-task').addEventListener('click', () => perform('같은 결제의 자료 전달 확인 중', () => selectedAction('recover')));
  $('approval-ack').addEventListener('change', updateControls);
  for (const id of ['budget', 'approval-expiry']) $(id).addEventListener('input', () => { $('approval-ack').checked = false; updateControls(); });
  $('approval-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!$('approval-form').reportValidity()) return;
    perform('결제 조건 승인 중', async () => {
      const task = active();
      if (!liveQuote(task)) throw { code: 'APPROVAL_EXPIRED' };
      if (!$('approval-ack').checked) throw { code: 'EXPLICIT_APPROVAL_REQUIRED' };
      const cap = $('budget').value.trim();
      if (!/^[1-9][0-9]{0,18}$/.test(cap) || BigInt(cap) < BigInt(task.quote.amountAtomic)) throw { code: 'BUDGET_DENIED' };
      const expiresAt = new Date($('approval-expiry').value).toISOString();
      await selectedAction('approve', { quoteHash: task.quote.hash, budgetAtomic: cap, expiresAt, acknowledge: true });
    });
  });
  $('request-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!$('request-form').reportValidity()) return;
    perform('분석 요청 생성 중', async () => {
      if (!state.wallet) throw { code: 'AUTHENTICATION_REQUIRED' };
      const start = new Date($('window-start').value), end = new Date($('window-end').value);
      if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) ||
          start >= end || end.getTime() > Date.now() || end - start > 7 * 86_400_000) throw { code: 'INVALID_ANALYTICS_SCOPE' };
      const task = await api('/api/tasks', 'POST', { purpose: $('purpose').value.trim(), wallet: $('report-wallet').value.trim(),
        windowStart: start.toISOString(), windowEnd: end.toISOString() });
      acceptTask(task); state.activeId = task.id;
    });
  });
  $('download-report').addEventListener('click', () => {
    const task = active();
    if (!task?.result?.answer || typeof task.result.markdown !== 'string') return;
    const blob = new Blob([task.result.markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob), anchor = element('a');
    anchor.href = url; anchor.download = ('Floww_' + task.id.replace(/[^A-Za-z0-9-]/g, '') + '_이체_분석.md').normalize('NFC');
    document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  let polling = false;
  const poll = setInterval(async () => {
    if (document.hidden || state.busy || polling || !state.wallet) return;
    updateControls();
    const task = active();
    if (!task || !(['SIGNING', 'PENDING', 'UNKNOWN'].includes(task.payment) || task.delivery === 'PENDING')) return;
    polling = true;
    try { await refreshSelected(); if (!state.busy) render(); }
    catch (error) { if (error.status === 401) clearSession(); }
    finally { polling = false; }
  }, 5000);
  window.addEventListener('pagehide', () => clearInterval(poll), { once: true });
  $('window-end').value = localDate(Date.now() - 1000);
  $('window-start').value = localDate(Date.now() - 86_400_000);
  render();
  (async () => {
    try { state.health = await api('/api/health'); } catch { /* keep an unready state */ }
    try {
      const session = await api('/api/session');
      state.wallet = session.wallet;
      if (!$('report-wallet').value.trim()) $('report-wallet').value = session.wallet;
      await loadTasks();
    } catch (error) { if (error.status !== 401) notice(error.code); }
    state.initializing = false;
    render();
  })();
})();
