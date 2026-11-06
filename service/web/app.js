(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const state = { wallet: null, health: null, tasks: [], activeId: null, initializing: true, busy: false, busyOperation: '', busyToken: null, approvalHash: null, provider: null,
    nextCursor: null, pendingCreate: null, sessionEpoch: 0, selectionEpoch: 0, pendingSelection: null,
    selectionTarget: null, routeManaged: false, navigationEpoch: 0 };
  const locale = window.FlowwLocale, authored = locale.copy;
  const put = (node, value) => locale.text(node, value, () => state.sessionEpoch);
  let announcedWallet, announcedGeneration;
  const policyNames = { PENDING: authored('승인 대기'), ALLOW: authored('승인됨'), DENY: authored('승인되지 않음') };
  const paymentNames = { NOT_STARTED: authored('시작 전'), SIGNING: authored('서명 준비 중'), PENDING: authored('확인 중'), UNKNOWN: authored('확인 필요'), CONFIRMED: authored('결제 확인됨'), FAILED: authored('거래 실패') };
  const deliveryNames = { NOT_STARTED: authored('시작 전'), PENDING: authored('전달 확인 중'), COMPLETED: authored('전달 완료'), FAILED: authored('전달 확인 필요') };
  const eventNames = { TASK_CREATED: authored('자료 요청 생성'), QUOTE_READY: authored('결제 조건 확인'), APPROVED: authored('지출 조건 승인'),
    POLICY_DENIED: authored('승인 조건 확인 필요'), APPROVAL_REVOKED: authored('승인 취소'), EXECUTION_CLAIMED: authored('승인 확인 및 서명 준비'),
    PAYMENT_SUBMITTED: authored('결제 요청 전달'), PAYMENT_OBSERVED: authored('결제·자료 상태 확인'), PAYMENT_RECONCILED: authored('원래 거래 상태 재확인'),
    REPORT_READY: authored('분석 결과 준비 완료'), REPORT_REJECTED: authored('자료 검증 확인 필요'), OPERATION_STOPPED: authored('실행 상태 확인 필요'), RECOVERY_REQUIRED: authored('이전 실행 상태 재확인 필요') };
  const errors = {
    UNAUTHORIZED_PAYMENT_TERMS: authored("수신자·토큰·네트워크가 승인할 결제 조건과 일치하지 않습니다. 현재 조건을 다시 확인한 뒤 승인하세요. 결제는 시작하지 않았습니다."),
    DAILY_BUDGET_EXCEEDED: authored("서버의 일일 결제 예산 한도에 도달했습니다. 원래 작업의 상태를 확인하고 한도가 이용 가능할 때 다시 진행하세요. 새 결제를 반복하지 마세요."),
    AUTHENTICATION_REQUIRED: authored('로그인이 필요합니다. 지갑을 다시 연결해 주세요.'),
    WALLET_NOT_AVAILABLE: authored('Phantom 지갑을 찾지 못했습니다. 지갑이 연결된 브라우저에서 열어 주세요.'),
    WALLET_DECLINED: authored('지갑 승인을 취소했습니다. 준비되면 다시 연결해 주세요.'),
    INVALID_WALLET: authored('유효한 Solana 지갑 주소를 입력해 주세요.'), INVALID_TASK: authored('요청 목적과 지갑 주소를 확인해 주세요.'),
    INVALID_ANALYTICS_SCOPE: authored('조회 기간은 현재 이전의 최대 7일로 설정해 주세요.'), INVALID_REPORT_WINDOW: authored('조회 기간을 다시 확인해 주세요.'),
    EXPLICIT_APPROVAL_REQUIRED: authored('결제 조건을 읽고 동의 항목을 선택해 주세요.'),
    BUDGET_DENIED: authored('지출 한도가 결제 금액보다 작거나 서비스 한도를 넘었습니다.'),
    INVALID_AMOUNT: authored('금액을 숫자로 입력하고 소수점 자릿수를 확인해 주세요.'),
    APPROVAL_EXPIRED: authored('결제 조건이나 승인의 기한이 지났습니다. 새 조건을 확인하고 다시 승인해 주세요.'),
    QUOTE_REQUIRED: authored('먼저 결제 조건을 확인해 주세요.'), PAYER_CHANGED: authored('서비스 결제 지갑이 바뀌었습니다. 새 조건을 확인해 주세요.'),
    PAYMENT_NOT_READY: authored('Devnet 결제 설정을 준비 중입니다. 설정이 완료된 뒤 승인할 수 있습니다.'),
    SIGNING_NOT_READY: authored('Devnet 결제 설정이 준비되지 않았습니다. 현재 요청은 실행되지 않았습니다.'),
    MERCHANT_NOT_CONFIGURED: authored('자료 제공 서비스의 연결을 준비 중입니다.'),
    FACILITATOR_UNAVAILABLE: authored('결제 검증 서비스에 연결하지 못했습니다. 현재 상태를 확인한 뒤 다시 시도해 주세요.'),
    QUOTE_UNAVAILABLE: authored('자료의 결제 조건을 가져오지 못했습니다. 잠시 후 다시 확인해 주세요.'),
    TASK_BUSY: authored('이 요청을 처리하고 있습니다. 상태가 갱신될 때까지 기다려 주세요.'),
    TASK_CHANGED: authored('요청 상태가 바뀌었습니다. 최신 상태를 확인해 주세요.'),
    EXECUTION_ALREADY_CLAIMED: authored('이미 시작한 실행입니다. 원래 결제의 상태를 확인해 주세요.'),
    RATE_LIMITED: authored('요청이 잠시 많아졌습니다. 잠시 후 다시 시도해 주세요.'),
    TASK_LIMIT_REACHED: authored('현재 보관할 수 있는 요청 수에 도달했습니다.'),
    INVALID_CHALLENGE: authored('로그인 확인이 만료됐습니다. 지갑을 다시 연결해 주세요.'),
    INVALID_SIGNATURE: authored('지갑 서명을 확인하지 못했습니다. 다시 로그인해 주세요.'),
    RESPONSE_UNAVAILABLE: authored('응답을 확인하지 못했습니다. 실행을 반복하기 전에 요청의 현재 상태를 확인해 주세요.'),
    SERVICE_UNAVAILABLE: authored('서비스에 연결하지 못했습니다. 잠시 후 상태를 다시 확인해 주세요.'),
  };
  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined && text !== null) put(node, text);
    if (className) node.className = className;
    return node;
  };
  const active = () => state.tasks.find(task => task.id === state.activeId) ?? null;
  const short = (value, count = 6) => typeof value === 'string' && value.length > count * 2 + 3 ? value.slice(0, count) + '…' + value.slice(-count) : value || authored('설정 대기');
  const dateText = value => locale.date(value);
  const localDate = value => {
    const date = new Date(value);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
  };
  const liveQuote = task => task?.quote && Date.parse(task.quote.expiresAt) > Date.now();
  const liveApproval = task => task?.approval && !task.approval.revoked && Date.parse(task.approval.expiresAt) > Date.now();
  const untouched = task => task?.payment === 'NOT_STARTED' && !task.archivedAt && !task.attemptRef &&
    !task.signedData && !task.transaction && !(task.events ?? []).some(event =>
      ['EXECUTION_CLAIMED', 'PAYMENT_PREPARED', 'PAYMENT_SUBMITTED', 'PAYMENT_OBSERVED', 'PAYMENT_RECONCILED'].includes(event.type));
  const sameQuote = (left, right) => left && right && ['hash', 'amountAtomic', 'asset', 'assetDecimals',
    'network', 'recipient', 'payer', 'resourceUrl', 'expiresAt'].every(key => left[key] === right[key]);
  function exactApproval(task) {
    const approval = task?.approval, quote = task?.quote;
    return untouched(task) && task.policy === 'ALLOW' && liveQuote(task) && liveApproval(task) &&
      typeof approval.id === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(approval.id) &&
      approval.quoteHash === quote.hash && approval.payer === quote.payer;
  }
  function assertSelection(selection) {
    if (state.sessionEpoch !== selection.sessionEpoch || state.wallet !== selection.wallet) throw { code: 'AUTHENTICATION_REQUIRED', stale: true };
    if (state.selectionEpoch !== selection.selectionEpoch || state.activeId !== selection.id) throw { code: 'TASK_CHANGED', stale: true };
  }
  function selectionSnapshot(id = state.activeId) { return { id, wallet: state.wallet, sessionEpoch: state.sessionEpoch, selectionEpoch: state.selectionEpoch }; }
  function assertTarget(selection) {
    if (state.sessionEpoch !== selection.sessionEpoch || state.wallet !== selection.wallet || state.selectionEpoch !== selection.selectionEpoch || state.selectionTarget !== selection.id) throw { code: 'TASK_CHANGED', stale: true };
  }
  function releaseSelectionRead() {
    if (!['task.load', 'task.refresh'].includes(state.busyOperation)) return;
    state.busy = false; state.busyOperation = ''; state.busyToken = null;
  }
  function routeContext(detail) {
    const id = detail?.id ?? null;
    if (id !== null && (typeof id !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))) return;
    state.routeManaged = true;
    if (state.selectionTarget === id && (!detail.clear || state.activeId === null)) return;
    state.selectionEpoch++; state.selectionTarget = id; state.pendingSelection = null;
    releaseSelectionRead();
    if (state.activeId !== id || detail.clear) { state.activeId = null; state.approvalHash = null; $('approval-ack').checked = false; }
    clearNotice(); render();
  }

  function notice(code) {
    put($('notice-text'), () => errors[code] ?? authored('요청을 처리하지 못했습니다. 현재 상태를 확인한 뒤 다시 진행해 주세요.'));
    $('notice').hidden = false;
  }
  function clearNotice() { $('notice').hidden = true; put($('notice-text'), () => ''); }
  function announce(text) { put($('live-status'), () => text); }

  async function api(path, method = 'GET', body, extraHeaders = {}) {
    const epoch = state.sessionEpoch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await fetch(path, { method, credentials: 'same-origin', redirect: 'error',
        headers: { ...(body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' }), ...extraHeaders },
        body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal,
      });
      const text = response.status === 204 ? '' : await response.text();
      if (epoch !== state.sessionEpoch) throw { code: 'AUTHENTICATION_REQUIRED', stale: true };
      if (response.status === 204) return null;
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

  function clearPrivateTasks() {
    state.tasks = []; state.activeId = null; state.selectionTarget = null; state.approvalHash = null; state.nextCursor = null; state.pendingCreate = null;
    $('request-form').reset(); $('approval-form').reset(); $('include-archived').checked = false;
    $('window-end').value = localDate(Date.now() - 1000); $('window-start').value = localDate(Date.now() - 86_400_000);
    clearNotice();
    for (const id of ['result-content', 'timeline', 'quote-details']) $(id).replaceChildren();
    for (const id of ['task-meta', 'quote-price', 'quote-atomic', 'quote-parties', 'proposal-note', 'approval-status', 'action-status', 'transaction-link', 'task-guidance']) put($(id), () => '');
    put($('execution-title'), () => authored('선택한 요청')); $('transaction-link').removeAttribute('href');
  }
  function clearSession() {
    state.sessionEpoch++; state.selectionEpoch++; state.pendingSelection = null;
    state.busy = false; state.busyOperation = ''; state.busyToken = null; state.wallet = null;
    clearPrivateTasks();
    render();
  }
  async function perform(operation, action) {
    if (state.busy || state.initializing) return;
    const token = {};
    clearNotice(); state.busy = true; state.busyOperation = operation; state.busyToken = token;
    render();
    try { await action(); if (state.busyToken === token) announce(authored('작업을 완료했습니다.')); }
    catch (error) {
      if (error?.stale || state.busyToken !== token) return;
      if (error?.status === 401) clearSession();
      notice(error?.code);
    } finally {
      if (state.busyToken === token) {
        state.busy = false; state.busyOperation = ''; state.busyToken = null;
        render(); flushSelection();
      }
    }
  }

  function denialGuidance(task) {
    if (task.reasonCode === 'APPROVAL_REVOKED') return authored('이 승인으로 새 결제를 실행하지 않습니다. 계속하려면 현재 조건을 확인하고 다시 승인하세요.');
    return ({ BUDGET_DENIED: authored("예산 한도가 결제 금액보다 작거나 서비스 한도를 넘었습니다. 현재 금액과 최대 예산을 확인한 뒤 다시 승인하세요. 결제는 시작하지 않았습니다."), UNAUTHORIZED_PAYMENT_TERMS: authored("수신자·토큰·네트워크가 승인할 결제 조건과 일치하지 않습니다. 현재 조건을 다시 확인한 뒤 승인하세요. 결제는 시작하지 않았습니다."), DAILY_BUDGET_EXCEEDED: authored("서버의 일일 결제 예산 한도에 도달했습니다. 원래 작업의 상태를 확인하고 한도가 이용 가능할 때 다시 진행하세요. 새 결제를 반복하지 마세요.") })[task.reasonCode] ?? authored("승인 조건이 충족되지 않았습니다. 현재 결제 조건과 예산을 확인한 뒤 다시 승인하세요. 결제는 시작하지 않았습니다.");
  }
  function taskSummary(task) {
    if (task.result?.answer || task.resultAvailable) return { text: authored('분석 완료'), className: 'success' };
    if (task.payment === 'CONFIRMED') return { text: task.delivery === 'COMPLETED' ? authored('자료 전달됨') : authored('자료 복구 필요'), className: task.delivery === 'COMPLETED' ? 'success' : 'warning' };
    if (task.payment === 'FAILED') return { text: authored('거래 실패'), className: 'error' };
    if (task.payment === 'UNKNOWN') return { text: authored('거래 확인 필요'), className: 'warning' };
    if (['SIGNING', 'PENDING'].includes(task.payment)) return { text: authored('실행 중'), className: '' };
    if (task.policy === 'DENY') return { text: authored('결제 승인이 거부됨'), className: 'warning' };
    if (task.policy === 'ALLOW' && liveApproval(task)) return { text: authored('실행 승인됨'), className: 'success' };
    if (task.quote && !liveQuote(task)) return { text: authored('조건 재확인 필요'), className: 'warning' };
    if (task.quote) return { text: authored('조건 승인 대기'), className: '' };
    return { text: authored('가격 확인 대기'), className: '' };
  }
  function guidance(task) {
    if (task.result?.answer) return authored('자료와 거래 근거를 확인했습니다. 아래에서 자산별 이체 결과를 살펴보세요.');
    if (task.payment === 'UNKNOWN') return authored('결제 결과가 아직 확정되지 않았습니다. 새 결제를 만들지 않고 원래 거래의 상태를 확인합니다.');
    if (task.payment === 'CONFIRMED' && task.delivery !== 'COMPLETED') return authored('결제는 확인됐습니다. 같은 결제를 사용해 자료 전달을 다시 확인할 수 있습니다.');
    if (task.payment === 'CONFIRMED') return authored('자료가 전달됐습니다. 내용 검증과 분석 결과의 상태를 확인해 주세요.');
    if (task.payment === 'FAILED') return authored('거래 실패가 확인됐습니다. 실행 기록과 거래 상태를 검토해 주세요.');
    if (['SIGNING', 'PENDING'].includes(task.payment)) return authored('승인된 요청을 처리하고 있습니다. 같은 결제를 다시 실행하지 않고 상태를 확인합니다.');
    if (task.policy === 'DENY') return denialGuidance(task);
    if (task.quote && !liveQuote(task)) return authored('결제 조건의 유효 시간이 지났습니다. 최신 조건을 확인한 뒤 다시 승인해 주세요.');
    if (task.policy === 'ALLOW' && liveApproval(task)) return authored('승인한 조건으로 실행할 준비가 됐습니다. 아래 실행 버튼을 누르면 Devnet 결제가 시작됩니다.');
    if (task.quote) return authored('수신자와 토큰, 금액을 확인한 뒤 승인하고 실행해 주세요.');
    return authored('실제 자료 제공 서비스에서 결제 조건을 가져온 뒤, 승인 여부를 결정할 수 있습니다.');
  }

  function renderHealth() {
    const health = state.health;
    put($('health-status'), () => health ? health.ready ? authored('Devnet 결제 설정 준비됨') : authored('Devnet 실행 설정 준비 중') : authored('설정 상태 확인 중'));
    put($('health-detail'), () => health ? health.ready ? authored('각 결제 직전에 승인과 네트워크를 다시 확인합니다.') : authored('요청을 보관하고, 연결 준비가 끝나면 조건을 확인할 수 있습니다.') : authored('현재 Devnet 환경을 확인하고 있습니다.'));
  }
  function renderHistory() {
    put($('task-count'), () => String(state.tasks.length));
    $('history-empty').hidden = state.tasks.length > 0;
    $('more-tasks').hidden = !state.nextCursor;
    $('task-list').replaceChildren(...state.tasks.map(task => {
      const button = element('button', null, 'task-item' + (task.id === state.activeId ? ' selected' : ''));
      button.type = 'button'; button.disabled = state.busy;
      button.setAttribute('aria-pressed', String(task.id === state.activeId));
      button.append(element('span', () => task.purpose, 'task-item-title'));
      const meta = element('span', null, 'task-item-meta');
      meta.append(element('span', () => dateText(task.createdAt)), element('span', () => task.archivedAt ? authored('보관됨 · ') + taskSummary(task).text : taskSummary(task).text, 'task-item-state'));
      button.append(meta);
      button.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('floww:task-navigation', { detail: { id: task.id } }));
        return requestSelection({ id: task.id });
      });
      return button;
    }));
  }
  function amountDisplay(amount, decimals) {
    try { return window.FlowwUnits.format(amount, decimals); }
    catch { return authored('금액 확인 필요'); }
  }
  function quoteDetail(label, value) {
    return [element('dt', () => label), element('dd', () => value || authored('설정 대기'))];
  }
  function renderQuote(task) {
    const quote = task.quote;
    $('quote-summary').hidden = !quote;
    $('proposal-note').hidden = !task.proposal?.explanation;
    put($('proposal-note'), () => task.proposal?.explanation || '');
    put($('quote-parties'), () => quote ? authored('결제 지갑 ') + short(quote.payer) + authored(' · 수신자 ') + short(quote.recipient) + authored(' · 토큰 mint ') + short(quote.asset) : '');
    if (!quote) { state.approvalHash = null; return; }
    put($('quote-price'), () => amountDisplay(quote.amountAtomic, quote.assetDecimals) + authored(' 토큰'));
    put($('quote-atomic'), () => quote.amountAtomic + authored(' 기본 단위'));
    $('quote-details').replaceChildren(...[
      ...quoteDetail(authored('결제 지갑'), quote.payer), ...quoteDetail(authored('수신자'), quote.recipient),
      ...quoteDetail(authored('토큰 mint'), quote.asset), ...quoteDetail(authored('네트워크'), 'Solana Devnet'),
      ...quoteDetail(authored('조건 기한'), () => dateText(quote.expiresAt)),
    ]);
    const displayed = task.id + ':' + quote.hash;
    if (state.approvalHash !== displayed) {
      state.approvalHash = displayed;
      $('budget').value = amountDisplay(quote.amountAtomic, quote.assetDecimals);
      $('approval-expiry').value = localDate(Math.min(Date.now() + 5 * 60_000, Date.parse(quote.expiresAt) - 1000));
      $('approval-ack').checked = false;
    }
    $('approval-expiry').max = localDate(quote.expiresAt);
    const approved = task.policy === 'ALLOW' && task.approval && !task.approval.revoked;
    $('approval-status').hidden = !approved;
    put($('approval-status'), () => approved ? authored('승인한 지출 한도 ') + amountDisplay(task.approval.budgetAtomic, quote.assetDecimals) + authored(' 토큰 · ') + dateText(task.approval.expiresAt) + authored('까지') : '');
  }
  function renderTimeline(task) {
    const events = Array.isArray(task.events) ? task.events : [];
    $('timeline').replaceChildren(...events.map(event => {
      const item = element('li');
      item.append(element('strong', () => eventNames[event.type] ?? authored('실행 상태 갱신')));
      const at = element('time', () => dateText(event.at));
      if (Number.isFinite(Date.parse(event.at))) at.dateTime = event.at;
      item.append(at); return item;
    }));
    const transaction = task.transaction;
    const safe = typeof transaction === 'string' && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(transaction);
    $('transaction-wrap').hidden = !safe;
    if (safe) {
      put($('transaction-link'), () => short(transaction, 12) + ' ↗');
      $('transaction-link').href = 'https://explorer.solana.com/tx/' + encodeURIComponent(transaction) + '?cluster=devnet';
    } else { $('transaction-link').removeAttribute('href'); put($('transaction-link'), () => ''); }
  }
  function renderResult(task) {
    const answer = task.result?.answer;
    $('result-empty').hidden = Boolean(answer);
    $('result-content').hidden = !answer;
    $('download-report').hidden = !answer || typeof task.result.markdown !== 'string' || !task.result.markdown;
    if (!answer) { $('result-content').replaceChildren(); return; }
    const pieces = [];
    if (answer.is_synthetic) pieces.push(element('p', () => authored('이 결과는 실제 네트워크에서 조회한 자료가 아닙니다.'), 'report-notice'));
    pieces.push(element('p', () => answer.complete ? authored('명시된 자료 범위 안에서 집계했습니다.') : authored('조회 자료의 일부만 확인됐습니다. 반환된 이체를 기준으로 집계합니다.'), 'report-notice' + (answer.complete ? ' good' : '')));
    pieces.push(element('p', () => answer.answer_text ?? authored('분석 내용이 준비됐습니다.'), 'report-summary'));
    if (Array.isArray(answer.totals) && answer.totals.length) {
      pieces.push(element('h3', () => authored('자산별 이체'), 'report-section-title'));
      for (const total of answer.totals) {
        const item = element('section', null, 'asset-total');
        const head = element('header');
        head.append(element('span', () => ({ in: authored('입금'), out: authored('출금'), self: authored('동일 지갑 이체') })[total.direction] ?? authored('이체')), element('span', () => String(total.transfer_count ?? 0) + authored('건')));
        item.append(head, element('strong', () => total.amount_display ?? ''), element('code', () => total.asset_ref ?? ''), element('code', () => String(total.amount_base_units ?? '') + authored(' 기본 단위')));
        pieces.push(item);
      }
    }
    for (const [title, values] of [[authored('자료 출처'), answer.source_refs], [authored('확인한 근거'), answer.evidence_refs], [authored('조회 범위와 참고 사항'), answer.limitations]]) {
      if (!Array.isArray(values) || !values.length) continue;
      const list = element('ul', null, 'report-list');
      list.append(...values.map(value => element('li', () => value)));
      pieces.push(element('h3', () => title, 'report-section-title'), list);
    }
    pieces.push(element('p', () => authored('이체 합계는 반환된 활동 내역이며 지갑 잔액이나 수익을 뜻하지 않습니다. 자료 시점: ') + dateText(answer.data_as_of), 'report-data-note'));
    $('result-content').replaceChildren(...pieces);
  }
  function renderSelection() {
    const task = active();
    $('selection-empty').hidden = Boolean(task); $('selection-content').hidden = !task;
    $('selection-content').dataset.resultReady = String(Boolean(task?.result?.answer));
    if (!task) return;
    put($('execution-title'), () => task.purpose);
    put($('task-meta'), () => short(task.wallet, 8) + ' · ' + dateText(task.windowStart) + ' – ' + dateText(task.windowEnd));
    const status = taskSummary(task);
    put($('task-state'), () => status.text); $('task-state').className = 'state-pill ' + status.className;
    put($('policy-state'), () => policyNames[task.policy] ?? authored('확인 필요'));
    put($('payment-state'), () => paymentNames[task.payment] ?? authored('확인 필요'));
    put($('delivery-state'), () => deliveryNames[task.delivery] ?? authored('확인 필요'));
    put($('task-guidance'), () => guidance(task));
    renderQuote(task); renderTimeline(task); renderResult(task);
  }
  function updateControls() {
    const task = active(), authenticated = Boolean(state.wallet), busy = state.busy || state.initializing;
    $('connect-wallet').disabled = busy || authenticated;
    put($('connect-wallet'), () => authenticated ? short(state.wallet) : busy && state.busyOperation === 'task.signIn' ? authored('로그인 중…') : authored('지갑 연결'));
    locale.attr($('connect-wallet'), 'title', () => authenticated ? state.wallet : authored('Phantom 지갑으로 로그인'), () => state.sessionEpoch);
    $('logout').hidden = !authenticated; $('logout').disabled = busy;
    $('create-task').disabled = !authenticated || busy;
    $('refresh-tasks').disabled = !authenticated || busy;
    $('login-hint').hidden = authenticated;
    document.querySelectorAll('.task-item').forEach(button => { button.disabled = busy; });
    for (const input of document.querySelectorAll('#request-form input,#request-form textarea,#approval-form input,#approval-form textarea')) input.disabled = busy;
    $('include-archived').disabled = busy || !authenticated; $('more-tasks').disabled = busy || !authenticated;
    put($('action-status'), () => busy ? authored(state.busyOperation || '설정 상태 확인 중') + '…' : '');
    if (!task) return;
    put($('task-guidance'), () => guidance(task));
    const status = taskSummary(task);
    put($('task-state'), () => status.text); $('task-state').className = 'state-pill ' + status.className;
    const notStarted = untouched(task);
    $('quote-task').hidden = !notStarted;
    put($('quote-task'), () => task.quote ? authored('결제 조건 다시 확인') : authored('결제 조건 확인'));
    $('quote-task').disabled = busy || !authenticated;
    $('approval-form').hidden = !notStarted || !task.quote || (task.policy === 'ALLOW' && liveApproval(task));
    $('approve-task').disabled = busy || !authenticated || !liveQuote(task) || !state.health?.ready || !$('approval-ack').checked;
    $('execute-task').hidden = !notStarted || task.policy !== 'ALLOW';
    $('execute-task').disabled = busy || !authenticated || !exactApproval(task) || !state.health?.ready;
    $('revoke-task').hidden = !notStarted || !task.approval || task.approval.revoked;
    $('revoke-task').disabled = busy || !authenticated;
    $('reconcile-task').hidden = !['UNKNOWN', 'PENDING', 'SIGNING'].includes(task.payment);
    $('reconcile-task').disabled = busy || !authenticated;
    $('recover-task').hidden = task.payment !== 'CONFIRMED' || Boolean(task.result?.answer);
    $('recover-task').disabled = busy || !authenticated || Boolean(task.approval?.revoked);
    $('refresh-task').disabled = busy || !authenticated;
    $('archive-task').hidden = Boolean(task.archivedAt);
    $('archive-task').disabled = busy || !authenticated || ['SIGNING', 'PENDING', 'UNKNOWN'].includes(task.payment);
    $('restore-task').hidden = !task.archivedAt; $('restore-task').disabled = busy || !authenticated;
  }
  function render() {
    renderHealth(); renderHistory(); renderSelection(); updateControls();
    if (announcedWallet !== state.wallet || announcedGeneration !== state.sessionEpoch) {
      announcedWallet = state.wallet; announcedGeneration = state.sessionEpoch; emitSession();
    }
    window.dispatchEvent(new CustomEvent('floww:selection', { detail: { wallet: state.wallet, task: active(), busy: state.busy } }));
  }
  function emitSession() { window.dispatchEvent(new CustomEvent('floww:session', { detail: {
    wallet: state.wallet, health: state.health, initializing: state.initializing, generation: state.sessionEpoch,
  } })); }
  function acceptTask(task) {
    if (!task || typeof task.id !== 'string') throw { code: 'RESPONSE_UNAVAILABLE' };
    const index = state.tasks.findIndex(old => old.id === task.id);
    if (index < 0) state.tasks.unshift(task);
    else if (Number(task.revision) >= Number(state.tasks[index].revision)) state.tasks[index] = task;
    window.dispatchEvent(new CustomEvent('floww:task-updated', { detail: { id: task.id } }));
  }
  async function loadTasks(more = false) {
    const query = new URLSearchParams({ limit: '20', includeArchived: String($('include-archived').checked) });
    if (more && state.nextCursor) query.set('cursor', state.nextCursor);
    const result = await api('/api/tasks?' + query);
    if (!state.wallet) return;
    const old = state.tasks;
    const page = Array.isArray(result.tasks) ? result.tasks : [];
    const known = new Map((more ? old : []).map(task => [task.id, task]));
    for (const task of page) {
      const detail = old.find(item => item.id === task.id);
      known.set(task.id, detail && detail.revision === task.revision ? { ...detail, ...task } : task);
    }
    state.tasks = [...known.values()]; state.nextCursor = result.nextCursor ?? null;
    if (!state.tasks.some(task => task.id === state.activeId)) {
      // A directly linked owned Task can be outside this list's pagination or
      // archive filter. Keep its identity for the fresh guarded detail read;
      // do not substitute the first summary or revive cached detail content.
      state.activeId = state.routeManaged ? state.activeId === state.selectionTarget ? state.activeId : null : state.tasks[0]?.id ?? null;
    }
    if (!state.routeManaged) state.selectionTarget = state.activeId;
    if (state.activeId) await refreshSelected();
  }
  async function selectedAction(action, body = {}, id = state.activeId) {
    const task = active();
    if (!task || task.id !== id) throw { code: 'TASK_CHANGED' };
    const selection = selectionSnapshot(id); let updated;
    try { updated = await api('/api/tasks/' + encodeURIComponent(id) + '/' + action, 'POST', body); }
    catch (error) { assertSelection(selection); throw error; }
    assertSelection(selection);
    if (updated?.id !== id) throw { code: 'RESPONSE_UNAVAILABLE' };
    if (state.wallet) acceptTask(updated);
    return updated;
  }
  async function refreshSelected() {
    const id = state.activeId;
    if (!id) return;
    const selection = selectionSnapshot(id); let updated;
    try { updated = await api('/api/tasks/' + encodeURIComponent(id)); }
    catch (error) { assertSelection(selection); throw error; }
    assertSelection(selection);
    if (updated?.id !== id) throw { code: 'RESPONSE_UNAVAILABLE' };
    if (state.wallet) acceptTask(updated);
  }
  function requestSelection(detail) {
    const id = detail?.id;
    if (!state.wallet || typeof id !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) return;
    if (id !== state.selectionTarget) {
      state.selectionEpoch++; state.selectionTarget = id; state.activeId = null; state.pendingSelection = null;
      releaseSelectionRead();
    }
    const requested = { id, prepareQuote: detail.prepareQuote === true };
    if (state.busy || state.initializing) {
      if (state.busyOperation !== 'task.load' || requested.prepareQuote) state.pendingSelection = requested;
      return;
    }
    const selection = selectionSnapshot(id);
    return perform('task.load', async () => {
      let task;
      try { task = await api('/api/tasks/' + encodeURIComponent(id)); }
      catch (error) { assertTarget(selection); throw error; }
      assertTarget(selection);
      if (task?.id !== id) throw { code: 'RESPONSE_UNAVAILABLE' };
      if (!state.wallet) return;
      acceptTask(task); state.activeId = id;
      if (requested.prepareQuote && untouched(task) && !task.quote) {
        state.busyOperation = 'task.quote'; render();
        await selectedAction('quote', {}, id);
      }
    });
  }
  function flushSelection() {
    if (state.busy || state.initializing || !state.pendingSelection) return;
    const detail = state.pendingSelection; state.pendingSelection = null;
    if (state.wallet) return requestSelection(detail);
  }

  $('dismiss-notice').addEventListener('click', clearNotice);
  $('connect-wallet').addEventListener('click', () => perform('task.signIn', async () => {
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
    if (state.wallet && state.wallet !== session.wallet) {
      state.sessionEpoch++; state.selectionEpoch++; state.pendingSelection = null;
      // A verified replacement owner gets a clean private surface, while the
      // current sign-in keeps its own busy lease through new-owner loading.
      clearPrivateTasks();
    }
    state.sessionEpoch++; state.wallet = session.wallet;
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
    render(); await loadTasks();
  }));
  $('logout').addEventListener('click', () => perform('task.signOut', async () => {
    await api('/api/auth/logout', 'POST', {}); clearSession();
  }));
  $('refresh-tasks').addEventListener('click', () => perform('task.list', loadTasks));
  $('include-archived').addEventListener('change', () => perform('task.archiveList', () => loadTasks()));
  $('more-tasks').addEventListener('click', () => perform('task.earlier', () => loadTasks(true)));
  $('archive-task').addEventListener('click', () => perform('task.archive', async () => { await selectedAction('archive', { acknowledge: true }); await loadTasks(); }));
  $('restore-task').addEventListener('click', () => perform('task.restore', async () => { await selectedAction('restore'); await loadTasks(); }));
  window.addEventListener('floww:session-refresh', emitSession);
  window.addEventListener('floww:session-expired', event => { if (state.wallet && event.detail?.wallet === state.wallet) clearSession(); });
  window.addEventListener('floww:route-context', event => routeContext(event.detail));
  window.addEventListener('floww:route-change', () => { state.navigationEpoch++; });
  window.addEventListener('floww:select-task', event => requestSelection(event.detail));
  $('refresh-task').addEventListener('click', () => perform('task.refresh', refreshSelected));
  $('quote-task').addEventListener('click', () => perform('task.quote', () => selectedAction('quote')));
  $('execute-task').addEventListener('click', () => perform('task.execute', async () => {
    const task = active();
    if (!exactApproval(task)) throw { code: 'APPROVAL_EXPIRED' };
    if (!state.health?.ready) throw { code: 'PAYMENT_NOT_READY' };
    await selectedAction('execute', { approvalId: task.approval.id }, task.id);
  }));
  $('revoke-task').addEventListener('click', () => perform('task.revoke', () => selectedAction('revoke')));
  $('reconcile-task').addEventListener('click', () => perform('task.reconcile', () => selectedAction('reconcile')));
  $('recover-task').addEventListener('click', () => perform('task.recover', () => selectedAction('recover')));
  $('approval-ack').addEventListener('change', updateControls);
  for (const id of ['budget', 'approval-expiry']) $(id).addEventListener('input', () => { $('approval-ack').checked = false; updateControls(); });
  $('approval-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!$('approval-form').reportValidity()) return;
    perform('task.approve', async () => {
      const task = active();
      if (!untouched(task)) throw { code: 'EXECUTION_ALREADY_CLAIMED' };
      if (!liveQuote(task)) throw { code: 'APPROVAL_EXPIRED' };
      if (!$('approval-ack').checked) throw { code: 'EXPLICIT_APPROVAL_REQUIRED' };
      if (!state.health?.ready) throw { code: 'PAYMENT_NOT_READY' };
      const cap = window.FlowwUnits.parse($('budget').value, task.quote.assetDecimals);
      if (BigInt(cap) < BigInt(task.quote.amountAtomic)) throw { code: 'BUDGET_DENIED' };
      const expiresAt = new Date($('approval-expiry').value).toISOString();
      const selection = { id: task.id, wallet: state.wallet, sessionEpoch: state.sessionEpoch, selectionEpoch: state.selectionEpoch };
      const quote = { ...task.quote };
      let approved;
      try {
        approved = await api('/api/tasks/' + encodeURIComponent(selection.id) + '/approve', 'POST',
          { quoteHash: quote.hash, budgetAtomic: cap, expiresAt, acknowledge: true });
      } catch (error) {
        if (error.status === 403 && ['BUDGET_DENIED', 'UNAUTHORIZED_PAYMENT_TERMS'].includes(error.code)) {
          // The server persists these refusals. Read that same task once, but
          // never restore a response belonging to an old owner or selection.
          assertSelection(selection);
          try {
            const denied = await api('/api/tasks/' + encodeURIComponent(selection.id));
            assertSelection(selection);
            if (denied?.id !== selection.id) throw { code: 'RESPONSE_UNAVAILABLE' };
            acceptTask(denied);
          } catch (refreshError) {
            if (refreshError.stale || refreshError.status === 401 || refreshError.code === 'TASK_CHANGED') throw refreshError;
            // An unavailable read does not hide the known approval refusal.
          }
        }
        throw error;
      }
      assertSelection(selection);
      if (approved?.id !== selection.id || !sameQuote(approved.quote, quote) || !exactApproval(approved) ||
          approved.wallet !== task.wallet || approved.windowStart !== task.windowStart || approved.windowEnd !== task.windowEnd ||
          approved.approval.budgetAtomic !== cap || approved.approval.expiresAt !== expiresAt) throw { code: 'TASK_CHANGED' };
      acceptTask(approved); assertSelection(selection);
      await selectedAction('execute', { approvalId: approved.approval.id }, selection.id);
    });
  });
  $('request-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!$('request-form').reportValidity()) return;
    perform('task.create', async () => {
      if (!state.wallet) throw { code: 'AUTHENTICATION_REQUIRED' };
      const start = new Date($('window-start').value), end = new Date($('window-end').value);
      if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) ||
          start >= end || end.getTime() > Date.now() || end - start > 7 * 86_400_000) throw { code: 'INVALID_ANALYTICS_SCOPE' };
      const body = { purpose: $('purpose').value.trim(), wallet: $('report-wallet').value.trim(), windowStart: start.toISOString(), windowEnd: end.toISOString() };
      const serialized = JSON.stringify(body);
      if (state.pendingCreate?.serialized !== serialized) state.pendingCreate = { serialized, key: crypto.randomUUID() };
      const selection = selectionSnapshot(), navigationEpoch = state.navigationEpoch;
      const task = await api('/api/tasks', 'POST', body, { 'Idempotency-Key': state.pendingCreate.key });
      state.pendingCreate = null;
      acceptTask(task);
      if (selection.selectionEpoch === state.selectionEpoch && navigationEpoch === state.navigationEpoch) {
        state.activeId = task.id; state.selectionTarget = task.id;
        window.dispatchEvent(new CustomEvent('floww:task-navigation', { detail: { id: task.id, created: true } }));
      }
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
    catch (error) { if (!error.stale && error.status === 401) clearSession(); }
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
      state.sessionEpoch++; state.wallet = session.wallet;
      emitSession();
      if (!$('report-wallet').value.trim()) $('report-wallet').value = session.wallet;
      await loadTasks();
    } catch (error) { if (!error.stale && error.status !== 401) notice(error.code); }
    state.initializing = false;
    render(); emitSession(); flushSelection();
  })();
})();
