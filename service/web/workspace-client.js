(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const state = { wallet: null, epoch: 0, view: 'assistant', busy: false, health: null,
    conversations: [], conversationCursor: null, conversation: null, memories: [], memoryCursor: null,
    mandates: [], dashboard: null, catalog: [], activities: [], tasks: [], pendingMessage: null, pendingPlan: null, stage: null, taskBusy: false, selectedTask: null, guestPending: null, authReady: false,
    scopeBaseline: { wallet: '', start: '', end: '' } };
  const views = {
    overview: ['YOUR WORKSPACE', '좋은 결정은, 분명한 목적에서.', '목적과 근거, 실행의 흐름을 한곳에서 관리하세요.'],
    assistant: ['YOUR NEXT FLOW', '어떤 결과를 원하세요?', '원하는 일을 말해 주세요. 필요한 정보와 계획을 함께 정리합니다.'],
    tasks: ['EXECUTION & EVIDENCE', '모든 실행에, 분명한 근거를.', '승인한 조건부터 결제·자료 전달·분석 결과까지 이어 봅니다.'],
    memory: ['YOUR CONTEXT', '다음 대화에도 이어질 맥락.', '직접 저장한 선호를 관리하고 대화마다 사용 여부를 정하세요.'],
    budgets: ['BOUNDED AUTHORITY', '한도를 정하고, 흐름을 살피세요.', '목적에 맞는 예산 권한과 예약·사용 내역을 확인하세요.'],
    activity: ['WORKSPACE ACTIVITY', '변경의 흐름을 한눈에.', '내 대화와 기억이 바뀐 시점을 확인하세요.'],
  };
  const statuses = { CLARIFICATION_REQUIRED: '추가 정보 필요', READY_TO_PLAN: '계획 작성 가능', UNSUPPORTED: '범위 확인 필요',
    REFINING: '목적 확인 중', PLANNING: '계획 검토 중', APPROVAL_REQUIRED: '계획 확인 필요', TASK_CREATED: '작업 연결됨',
    LINKING: '작업 연결 확인', ATTENTION_REQUIRED: '다시 확인 필요' };
  const errors = {
    AUTHENTICATION_REQUIRED: '지갑을 연결하고 로그인해 주세요.', MODEL_NOT_CONFIGURED: 'AI 연결을 준비 중입니다. 작업 화면에서 조회 범위를 직접 지정할 수 있습니다.',
    WORKSPACE_MODEL_UNAVAILABLE: 'AI 응답을 받지 못했습니다. 현재 대화를 확인한 뒤 새로 요청해 주세요.',
    WORKSPACE_INVALID_MODEL_OUTPUT: 'AI가 반환한 계획을 검증하지 못했습니다. 조건을 확인한 뒤 다시 요청해 주세요.',
    WORKSPACE_SCOPE_REQUIRED: '분석할 지갑과 조회 기간을 구체적으로 지정해 주세요.', WORKSPACE_STALE_CONTEXT: '요청 조건과 AI의 해석이 일치하지 않았습니다. 최신 조건을 다시 확인해 주세요.',
    WORKSPACE_PLAN_REJECTED: '검토를 통과하지 못했습니다. 목적과 범위를 조정해 주세요.', WORKSPACE_RESOURCE_UNAVAILABLE: '선택할 자료의 연결을 준비 중입니다.',
    WORKSPACE_INVALID_INPUT: '요청 내용과 기억의 형식을 확인해 주세요.', WORKSPACE_TIMEOUT: 'AI 응답 시간이 지났습니다. 대화의 현재 상태를 확인해 주세요.',
    WORKSPACE_CHANGED: '다른 요청으로 내용이 바뀌었습니다. 최신 상태를 불러왔습니다. 확인한 뒤 다시 진행해 주세요.',
    PLAN_CHANGED: '대화나 계획이 바뀌었습니다. 최신 계획을 다시 확인해 주세요.', PLAN_SCOPE_CHANGED: '확정한 계획과 조회 범위가 다릅니다. 현재 계획의 조건을 확인해 주세요.',
    CONVERSATION_BUSY: '이 대화에서 이전 요청을 처리 중입니다. 잠시 후 대화를 다시 열어 주세요.',
    CONVERSATION_ALREADY_LINKED: '이미 작업으로 연결한 대화입니다. 조건을 바꾸려면 새 대화를 만들어 주세요.',
    CONVERSATION_MESSAGE_LIMIT: '이 대화의 길이 한도에 도달했습니다. 새 대화에서 이어가 주세요.',
    CONVERSATION_REQUEST_LIMIT: '이 대화의 요청 한도에 도달했습니다. 새 대화에서 이어가 주세요.',
    WORKSPACE_OPERATION_EXPIRED: '이전 요청의 응답을 확인하지 못했습니다. 현재 조건으로 다시 요청할 수 있습니다.',
    TASK_LINK_CONFIRMATION_REQUIRED: '작업 연결 결과를 확인해 주세요. 같은 계획으로 다시 확인하며 중복 작업을 만들지 않습니다.',
    MODEL_DAILY_LIMIT: '오늘의 AI 요청 한도에 도달했습니다. 작업 화면에서 직접 조회 범위를 지정할 수 있습니다.',
    OPERATION_LIMIT_REACHED: '현재 처리 중인 요청이 있습니다. 잠시 후 다시 시도해 주세요.', WORKSPACE_BUSY: 'AI가 다른 요청을 처리 중입니다. 잠시 후 다시 시도해 주세요.',
    INTENT_INCOMPLETE: '목적과 지갑, 조회 기간을 먼저 정해 주세요.', INVALID_WORKSPACE_TEXT: '비어 있거나 너무 긴 내용이 있습니다. 입력을 확인해 주세요.',
    SECRET_CONTENT_REJECTED: '비밀키나 접근 토큰은 대화와 기억에 저장할 수 없습니다.', INVALID_WALLET: '유효한 Solana 지갑 주소를 입력해 주세요.',
    UNREGISTERED_RESOURCE_URL: '등록된 지갑 이체 자료를 사용합니다. 외부 주소 대신 목적과 분석 지갑을 입력해 주세요.',
    INVALID_TIME: '날짜와 시간을 확인해 주세요.', INVALID_ANALYTICS_SCOPE: '현재 이전의 최대 7일 범위로 지정해 주세요.',
    INVALID_MEMORY_EXPIRY: '기억 보관 기한은 현재 이후 최대 90일입니다.', MEMORY_IS_NOT_AUTHORITY: '보고서 형식이나 분석 선호를 저장해 주세요. 지갑·결제·권한 설정은 해당 화면에서 관리합니다.',
    EXPLICIT_MEMORY_CONSENT_REQUIRED: '기억 저장 동의 항목을 선택해 주세요.', MEMORY_CHANGED: '사용 중인 기억이 삭제되거나 바뀌어 응답을 중단했습니다. 최신 기억으로 다시 요청해 주세요.',
    WORKSPACE_LIMIT_REACHED: '현재 보관 한도에 도달했습니다. 사용하지 않는 기억을 정리하거나 기존 대화를 이어가 주세요.',
    MANDATE_NOT_ACTIVE: '적용할 예산 권한이 만료되거나 취소됐습니다. 권한 상태를 확인해 주세요.', MANDATE_CHANGED: '예산 권한이 바뀌었습니다. 최신 상태를 확인해 주세요.',
    INVALID_MANDATE: '목적·조회 범위·금액·실행 수·기한을 확인해 주세요.', INVALID_AMOUNT: '토큰 금액은 숫자와 소수점 6자리 이내로 입력해 주세요.',
    EXPLICIT_APPROVAL_REQUIRED: '조건을 읽고 동의 항목을 선택해 주세요.', RESPONSE_UNAVAILABLE: '응답을 확인하지 못했습니다. 새 요청을 반복하기 전에 현재 상태를 확인해 주세요.',
    IDEMPOTENCY_CONFLICT: '동일한 요청 식별자의 조건이 다릅니다. 최신 상태를 확인해 주세요.', SERVICE_UNAVAILABLE: '서비스에 연결하지 못했습니다. 잠시 후 다시 확인해 주세요.',
  };
  const eventNames = { CONVERSATION_CREATED: '새 대화를 만들었습니다', CONVERSATION_UPDATED: '대화 상태를 저장했습니다',
    MEMORY_CREATED: '기억을 저장했습니다', MEMORY_UPDATED: '기억을 수정했습니다', MEMORY_REMOVED: '기억을 삭제했습니다' };
  const el = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined && text !== null) n.textContent = String(text); if (cls) n.className = cls; return n; };
  const empty = (node, text) => node.replaceChildren(el('p', text, 'empty-copy'));
  const short = value => typeof value === 'string' && value.length > 18 ? value.slice(0, 8) + '…' + value.slice(-6) : value ?? '';
  const local = date => { const d = new Date(date); return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 19); };
  const when = value => Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) : '시간 확인 필요';
  const token = value => {
    if (typeof value !== 'string' || !/^[0-9]{1,39}$/.test(value)) return '—';
    const padded = value.padStart(7, '0'), frac = padded.slice(-6).replace(/0+$/, '');
    return padded.slice(0, -6) + (frac ? '.' + frac : '');
  };
  function status(text = '', isError = false) { $('shell-status').textContent = text; $('shell-status').className = 'shell-status' + (isError ? ' is-error' : ''); }
  function errorMessage(error) { return errors[error?.code] ?? '요청을 완료하지 못했습니다. 입력한 조건과 현재 상태를 다시 확인해 주세요.'; }
  async function api(path, method = 'GET', body) {
    const epoch = state.epoch, controller = new AbortController(), timer = setTimeout(() => controller.abort(), 40_000);
    try {
      const response = await fetch(path, { method, credentials: 'same-origin', redirect: 'error', signal: controller.signal,
        headers: { accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body) });
      const text = response.status === 204 ? '' : await response.text();
      if (state.epoch !== epoch) throw { code: 'AUTHENTICATION_REQUIRED', status: 401 };
      if (text.length > 400_000) throw { code: 'RESPONSE_UNAVAILABLE' };
      let value; try { value = text ? JSON.parse(text) : null; } catch { throw { code: 'RESPONSE_UNAVAILABLE' }; }
      if (!response.ok) {
        if (response.status === 401) window.dispatchEvent(new CustomEvent('floww:session-expired', { detail: { wallet: state.wallet } }));
        throw { code: value?.error?.code ?? 'SERVICE_UNAVAILABLE', status: response.status };
      }
      return value;
    } catch (error) { if (error.code) throw error; throw { code: error.name === 'AbortError' ? 'RESPONSE_UNAVAILABLE' : 'SERVICE_UNAVAILABLE' }; }
    finally { clearTimeout(timer); }
  }
  async function run(label, action, { refreshConversation = false } = {}) {
    if (state.busy) return;
    if (!state.wallet) { status(errors.AUTHENTICATION_REQUIRED, true); $('connect-wallet').focus(); return; }
    const epoch = state.epoch; state.busy = true; status(label + '…'); controls(); renderJourney();
    try { await action(); if (epoch === state.epoch) status(''); }
    catch (error) {
      if (epoch !== state.epoch) return;
      if (refreshConversation && state.conversation) {
        try { state.conversation = await api('/api/conversations/' + encodeURIComponent(state.conversation.id)); syncScope(); await loadConversations(); } catch { /* preserve last known view */ }
      }
      status(errorMessage(error), true);
    } finally { if (epoch === state.epoch) { state.busy = false; state.stage = null; renderConversation(); controls(); } }
  }
  function metric(label, value, note) { const node = el('article', null, 'metric-card'); node.append(el('span', label), el('strong', value), el('p', note)); return node; }
  function taskStatus(t) {
    if (t.resultAvailable) return '분석 완료';
    if (t.payment === 'UNKNOWN') return '거래 확인 필요';
    if (t.payment === 'CONFIRMED') return t.delivery === 'COMPLETED' ? '자료 전달 완료' : '자료 복구 필요';
    if (['SIGNING', 'PENDING'].includes(t.payment)) return '거래 확인 중';
    if (t.payment === 'FAILED') return '거래 실패';
    return t.policy === 'ALLOW' ? '결제 실행 대기' : '조건 확인 필요';
  }
  function activityRows(events) {
    return events.map(event => { const row = el('div', null, 'compact-row'); const body = el('div');
      body.append(el('p', eventNames[event.type] ?? '워크스페이스 상태가 바뀌었습니다'), el('small', '기록 ' + short(event.recordId) + ' · 버전 ' + event.revision));
      row.append(body, el('time', when(event.at))); return row; });
  }
  function renderOverview() {
    const d = state.dashboard;
    $('dashboard-metrics').replaceChildren(...[
      metric('진행 중인 작업', d ? String(d.tasks.active) : '—', '보관하지 않은 내 요청'),
      metric('확인된 분석 결과', d ? String(d.tasks.resultAvailable) : '—', '내 작업의 자료 근거'),
      metric('상태 확인이 필요한 작업', d ? String(d.tasks.recoveryRequired) : '—', '원래 거래와 자료를 확인'),
      metric('저장한 기억', d ? String(d.workspace.memory) : '—', '대화별로 사용 여부 선택'),
    ]);
    if (!state.wallet) {
      empty($('dashboard-tasks'), '지갑으로 로그인하면 내 작업을 이어 볼 수 있습니다.');
      empty($('dashboard-activity'), '로그인하면 내 활동 기록을 확인할 수 있습니다.');
    } else {
      if (!state.tasks.length) empty($('dashboard-tasks'), '아직 만든 작업이 없습니다. 새 대화에서 시작하세요.');
      else $('dashboard-tasks').replaceChildren(...state.tasks.slice(0, 4).map(task => {
        const row = el('button', null, 'compact-row is-button'); row.type = 'button'; const body = el('div');
        body.append(el('p', task.purpose), el('small', short(task.wallet) + ' · ' + when(task.createdAt)));
        row.append(body, el('span', taskStatus(task), 'state-pill')); row.addEventListener('click', () => selectTask(task.id)); return row;
      }));
      if (!d?.activity?.length) empty($('dashboard-activity'), '대화와 기억의 변경 기록이 여기에 표시됩니다.');
      else $('dashboard-activity').replaceChildren(...activityRows(d.activity.slice(0, 4)));
    }
    if (!state.catalog.length) empty($('resource-catalog'), state.wallet ? '등록된 자료의 연결 상태를 확인하고 있습니다.' : '로그인하면 사용 가능한 자료와 조회 범위를 확인할 수 있습니다.');
    else $('resource-catalog').replaceChildren(...state.catalog.map(resource => {
      const row = el('div', null, 'catalog-row'), detail = el('div', null, 'catalog-details');
      detail.append(el('h3', resource.name), el('p', resource.description), el('p', 'Solana Devnet · 최대 ' + resource.maxWindowDays + '일 · 반환된 이체 내역 범위'));
      row.append(el('span', '≋', 'catalog-symbol'), detail, el('span', resource.status === 'AVAILABLE' ? '조회 자료 연결됨' : '연결 설정 중', 'state-pill'));
      return row;
    }));
  }
  async function loadOverview() {
    const [dashboard, taskPage, catalog] = await Promise.all([api('/api/dashboard'), api('/api/tasks?limit=4'), api('/api/catalog')]);
    state.dashboard = dashboard; state.tasks = taskPage.tasks; state.catalog = catalog.resources; renderOverview(); renderBudget();
  }
  async function loadConversations(more = false) {
    const query = new URLSearchParams({ limit: '20' }); if (more && state.conversationCursor) query.set('cursor', state.conversationCursor);
    const result = await api('/api/conversations?' + query);
    state.conversations = more ? [...state.conversations, ...result.items] : result.items; state.conversationCursor = result.nextCursor; renderConversationList();
  }
  function renderConversationList() {
    if (!state.conversations.length) empty($('conversation-list'), state.wallet ? '새 대화를 만들어 보세요.' : '로그인 후 대화를 시작하세요.');
    else $('conversation-list').replaceChildren(...state.conversations.map(item => {
      const b = el('button', null, 'conversation-item'); b.type = 'button'; b.setAttribute('aria-current', String(item.id === state.conversation?.id));
      b.append(el('strong', item.data.title), el('small', when(item.updatedAt) + ' · ' + (statuses[item.data.status] ?? '상태 확인')));
      b.addEventListener('click', () => run('대화 불러오는 중', async () => { state.conversation = await api('/api/conversations/' + encodeURIComponent(item.id)); syncScope(); state.pendingMessage = null; state.pendingPlan = null; requestLinkedTask(); renderConversationList(); }));
      return b;
    }));
    $('more-conversations').hidden = !state.conversationCursor;
  }
  function syncScope() {
    const intent = state.conversation?.intent;
    $('intent-wallet').value = intent?.wallet ?? '';
    $('intent-start').value = intent?.windowStart ? local(intent.windowStart) : '';
    $('intent-end').value = intent?.windowEnd ? local(intent.windowEnd) : '';
    state.scopeBaseline = rawScope();
  }
  function rawScope() { return { wallet: $('intent-wallet').value, start: $('intent-start').value, end: $('intent-end').value }; }
  function planScopeChanged() {
    const plan = state.conversation?.plan; if (!plan) return false;
    if (Object.entries(rawScope()).some(([key, value]) => value.trim() === '' && state.scopeBaseline[key] !== '')) return true;
    try { return Object.entries(explicitScope()).some(([key, value]) => plan.scope[key] !== value); }
    catch { return true; }
  }
  function controls() {
    const doing = state.busy || state.taskBusy, locked = !state.wallet || doing;
    const taskControl = node => { for (let p = node; p; p = p.parentNode) if (p.id === 'task-execution-column') return true; return false; };
    // The mounted task keeps its own exact-quote/health/expiry controls.
    for (const input of document.querySelectorAll('[data-page]:not([data-page=tasks]) input,[data-page]:not([data-page=tasks]) textarea,[data-page]:not([data-page=tasks]) select')) if (!taskControl(input)) input.disabled = locked;
    for (const b of document.querySelectorAll('[data-page]:not([data-page=tasks]) button:not([data-go])')) if (!taskControl(b)) b.disabled = locked;
    const c = state.conversation, immutable = Boolean(c?.linkedTaskId || c?.planLocked || c?.working);
    $('send-message').disabled = doing || immutable || !state.authReady; $('message-text').disabled = doing || immutable;
    $('send-message').textContent = !state.authReady ? '연결 확인 중…' : state.wallet ? '보내기 ↑' : '지갑 연결하고 시작';
    $('build-plan').disabled = locked || !c || immutable || c.intent?.missingFields?.length !== 0 || c.status === 'UNSUPPORTED';
    $('confirm-plan').disabled = locked || !c?.plan || c.working || Boolean(c.linkedTaskId) || planScopeChanged();
    if (c?.planLocked) $('plan-mandate').disabled = true;
    $('composer-hint').textContent = !state.wallet ? '요청을 먼저 적어 두세요. 지갑 연결 후 안전하게 이어집니다.' : immutable ? '확정한 범위와 결과를 이 대화에서 이어갑니다.' : doing ? '요청을 처리하고 있습니다.' : '필요한 정보를 대화로 확인합니다. 결제 전 조건을 보여 드려요.';
    for (const field of ['intent-wallet', 'intent-start', 'intent-end']) $(field).disabled = doing || immutable;
    $('new-conversation').disabled = locked;
    $('create-mandate').disabled = locked || !state.health?.merchantConfigured;
    $('budget-setup-note').hidden = !state.wallet || state.health?.merchantConfigured === true;
    $('budget-setup-note').textContent = '자료 제공자의 결제 조건 연결을 준비 중입니다. 연결 후 예산 권한을 만들 수 있습니다.';
  }
  function requestLinkedTask(prepareQuote = false) {
    const id = state.conversation?.linkedTaskId;
    if (state.wallet && id) window.dispatchEvent(new CustomEvent('floww:select-task', { detail: { id, prepareQuote } }));
  }
  function renderGuidedTask() {
    const slot = $('assistant-task-slot'), home = $('task-execution-home'), column = $('task-execution-column');
    const linked = state.view === 'assistant' && Boolean(state.wallet && state.conversation?.linkedTaskId);
    const exact = linked && state.selectedTask?.id === state.conversation.linkedTaskId;
    slot.hidden = !linked; $('assistant-task-loading').hidden = Boolean(exact);
    if (exact) { if (column.parentNode !== slot) slot.append(column); }
    else if (column.parentNode !== home) home.append(column);
  }
  function renderJourney() {
    const c = state.conversation, task = c?.linkedTaskId === state.selectedTask?.id ? state.selectedTask : null;
    $('journey-card').hidden = !state.wallet || (!c && !state.stage);
    let title = '필요한 정보를 함께 정리해요', copy = '목적과 범위를 대화로 확인합니다', stage = 0;
    if (state.stage === 'refining' || c?.status === 'REFINING') { title = '요청의 목적과 범위를 확인하고 있어요'; copy = '입력한 내용에서 필요한 정보를 정리합니다.'; }
    else if (state.stage === 'planning' || c?.status === 'PLANNING') { title = '필요한 자료와 계획을 검토하고 있어요'; copy = '같은 목적과 조회 범위에 맞는지 별도로 검토합니다.'; stage = 1; }
    else if (task) {
      stage = 2;
      if (task.result?.answer || task.resultAvailable) { title = '요청한 결과가 준비됐어요'; copy = '분석 요약과 근거를 먼저 확인하세요. 영수증과 실행 과정은 펼쳐 볼 수 있습니다.'; stage = 3; }
      else if (task.payment === 'UNKNOWN') { title = '원래 결제의 확인이 필요해요'; copy = '아직 결제 결과가 확정되지 않았습니다. 새 결제를 만들지 않고 원래 거래를 확인하세요.'; }
      else if (['SIGNING', 'PENDING'].includes(task.payment)) { title = '승인한 결제를 확인하고 있어요'; copy = '결제 확인과 자료 도착을 각각 확인합니다. 같은 요청을 다시 결제하지 않습니다.'; }
      else if (task.payment === 'CONFIRMED') { title = task.delivery === 'COMPLETED' ? '받은 자료의 분석을 확인해 주세요' : '결제는 확인됐지만 자료가 아직 도착하지 않았어요'; copy = '같은 결제로 자료와 분석을 다시 확인할 수 있습니다. 새 결제는 필요하지 않습니다.'; }
      else if (task.payment === 'FAILED') { title = '거래 실패를 확인했어요'; copy = '자동으로 새 결제를 만들지 않습니다. 원래 거래의 기록을 먼저 확인하세요.'; }
      else if (task.approval?.revoked) { title = '이 작업의 결제 승인을 취소했어요'; copy = '이 승인으로 새 결제를 실행하지 않습니다. 계속하려면 현재 조건을 확인하고 다시 승인하세요.'; }
      else if (task.quote && Date.parse(task.quote.expiresAt) <= Date.now()) { title = '결제 조건의 유효 시간이 지났어요'; copy = '아직 결제하지 않았습니다. 현재 가격과 조건을 다시 확인한 뒤 승인할 수 있습니다.'; }
      else if (task.quote) { title = '결제 조건을 확인하고 진행해 주세요'; copy = '현재 가격은 ' + token(task.quote.amountAtomic) + ' 토큰입니다. 아래에서 범위·한도·기한을 확인하고 승인하면 실행합니다.'; }
      else { title = state.taskBusy ? '이 계획의 결제 조건을 준비하고 있어요' : '요청을 저장했어요'; copy = state.health?.merchantConfigured ? '아직 결제하지 않았습니다. 현재 요청의 결제 조건을 확인할 수 있습니다.' : '자료 제공자의 연결을 준비 중입니다. 결제는 시작하지 않았고, 같은 요청에서 이어갈 수 있습니다.'; }
    } else if (c?.plan) { title = '목적에 맞는 계획을 정리했어요'; copy = planScopeChanged() ? '조회 조건을 바꿨다면 메시지로 보내 새 계획을 확인해 주세요.' : '아래 범위를 확인하면 정확한 결제 조건을 준비합니다. 아직 결제하지 않습니다.'; stage = 1; }
    else if (c?.errorCode) { title = '요청을 저장하고 잠시 멈췄어요'; copy = errors[c.errorCode] ?? '현재 조건을 확인한 뒤 명시적으로 다시 요청할 수 있습니다. 결제는 시작되지 않았습니다.'; }
    else { title = '필요한 정보를 함께 정리해요'; copy = '분석할 지갑과 기간을 대화로 알려 주세요. 복잡한 항목을 먼저 고를 필요가 없습니다.'; }
    if ($('journey-title').textContent !== title) $('journey-title').textContent = title;
    if ($('journey-copy').textContent !== copy) $('journey-copy').textContent = copy;
    $('journey-steps').replaceChildren(...['요청 이해', '계획 검토', '결제 조건·실행', '결과와 근거'].map((text, i) => {
      const item = el('li', text); if (i === stage) item.setAttribute('aria-current', 'step'); return item;
    }));
    renderGuidedTask();
  }
  function renderConversation() {
    const c = state.conversation;
    $('conversation-title').textContent = c?.title ?? '무엇을 알아보고 싶으세요?';
    $('conversation-state').textContent = c ? statuses[c.status] ?? '상태 확인' : '대화 시작';
    $('dialogue-empty').hidden = Boolean(c?.messages?.length);
    $('earlier-messages').hidden = !c?.previousMessages;
    $('dialogue-messages').replaceChildren(...(c?.messages ?? []).map(message => {
      const node = el('article', null, 'message ' + (message.role === 'user' ? 'user' : 'assistant'));
      node.append(el('span', message.role === 'user' ? '나' : 'FLOWW ASSISTANT', 'message-label'), el('p', message.text), el('time', when(message.at)));
      return node;
    }));
    const intent = c?.intent;
    $('intent-summary').replaceChildren(el('p', intent?.purpose ?? '목적을 알려 주시면 조회 범위를 함께 정리합니다.'));
    if (intent?.missingFields?.length) $('intent-summary').append(el('p', '확인할 항목: ' + intent.missingFields.map(f => ({ purpose: '목적', wallet: '지갑', windowStart: '시작 시간', windowEnd: '종료 시간', resourceId: '자료' })[f] ?? '조건').join(', ')));
    const content = $('plan-content'); content.replaceChildren();
    if (c?.errorCode) content.append(el('p', errors[c.errorCode] ?? '현재 상태를 확인한 뒤 다시 요청해 주세요.', 'plan-error'));
    if (c?.plan) {
      content.append(el('p', c.plan.summary, 'plan-summary'));
      c.plan.steps.forEach(step => content.append(el('p', '자료 선택 · ' + step.reason, 'plan-step')));
      content.append(el('p', '검토 에이전트 확인을 통과한 계획입니다.', 'plan-stamp'));
      const details = el('details', null, 'plan-details'), limits = el('ul', null, 'plan-limits');
      details.append(el('summary', '조회 범위와 제한 자세히 보기'));
      limits.append(...c.plan.limitations.map(v => el('li', v))); details.append(limits); content.append(details);
      content.append(el('p', short(c.plan.scope.wallet) + ' · ' + when(c.plan.scope.windowStart) + ' – ' + when(c.plan.scope.windowEnd), 'plan-stamp'));
      details.append(el('p', '모델 ' + c.plan.modelVersion + ' · 계획 버전 ' + c.plan.intentRevision, 'plan-stamp'));
    } else content.append(el('p', '목적과 범위가 정해지면 AI가 자료를 선택하고 별도로 검토합니다.', 'section-copy'));
    if (c?.linkedTaskId) {
      const box = el('div', null, 'plan-linked'), b = el('button', '작업과 결제 조건 확인 ↗', 'text-button'); b.type = 'button';
      box.append(el('p', '같은 계획으로 생성한 작업을 이어갈 수 있습니다.'), b); b.addEventListener('click', () => requestLinkedTask()); content.append(box);
    }
    $('build-plan').hidden = !c || Boolean(c.plan || c.linkedTaskId || c.planLocked || c.working) || !['ATTENTION_REQUIRED', 'READY_TO_PLAN'].includes(c.status);
    $('confirm-plan-form').hidden = !c?.plan || Boolean(c?.linkedTaskId);
    const selected = c?.planLocked ? c.confirmedMandateId ?? '' : $('plan-mandate').value;
    const choices = state.mandates.filter(m => m.status === 'ACTIVE' || m.id === selected);
    $('plan-mandate').replaceChildren(new Option('이번 작업의 조건을 별도 승인', ''), ...choices.map(m => new Option(m.purpose + ' · 남은 ' + token(m.remainingAtomic) + ' 토큰', m.id)));
    $('plan-mandate').value = selected; controls(); renderJourney();
  }
  async function createConversation() {
    const c = await api('/api/conversations', 'POST', { useMemory: $('conversation-memory').checked });
    state.conversation = c; state.pendingMessage = null; state.pendingPlan = null; syncScope();
    await loadConversations(); renderConversation(); $('message-text').focus();
  }
  function explicitScope() {
    const value = {}, raw = rawScope();
    if (raw.wallet.trim() && raw.wallet !== state.scopeBaseline.wallet) value.wallet = raw.wallet.trim();
    for (const [id, field, key] of [['intent-start', 'start', 'windowStart'], ['intent-end', 'end', 'windowEnd']]) if ($(id).value && raw[field] !== state.scopeBaseline[field]) {
      const d = new Date($(id).value); if (!Number.isFinite(d.getTime())) throw { code: 'INVALID_TIME' }; value[key] = d.toISOString();
    }
    return value;
  }
  function renderMemory() {
    if (!state.memories.length) empty($('memory-list'), state.wallet ? '아직 저장한 기억이 없습니다. 보고서 형식이나 선호를 추가해 보세요.' : '로그인하면 저장한 기억을 볼 수 있습니다.');
    else $('memory-list').replaceChildren(...state.memories.map(record => {
      const card = el('article', null, 'saved-card'); card.append(el('h3', record.data.key), el('p', record.data.value), el('small', '보관 기한 ' + when(record.data.expiresAt)));
      const b = el('button', '기억 삭제', 'text-button'); b.type = 'button'; b.addEventListener('click', () => run('기억 삭제 중', async () => { await api('/api/memories/' + encodeURIComponent(record.id), 'DELETE', { expectedRevision: record.revision }); await loadMemory(); }));
      card.append(b); return card;
    }));
    $('more-memory').hidden = !state.memoryCursor; controls();
  }
  async function loadMemory(more = false) {
    const query = new URLSearchParams({ limit: '20' }); if (more && state.memoryCursor) query.set('cursor', state.memoryCursor);
    const result = await api('/api/memories?' + query); state.memories = more ? [...state.memories, ...result.items] : result.items; state.memoryCursor = result.nextCursor; renderMemory();
  }
  function renderBudget() {
    const b = state.dashboard?.budget;
    $('budget-metrics').replaceChildren(metric('오늘 확인된 사용액', b ? token(b.spentAtomic) : '—', '내 Devnet 토큰 · UTC 기준'),
      metric('오늘 예약된 금액', b ? token(b.heldAtomic) : '—', '내 Devnet 토큰 · UTC 기준'), metric('사용 중인 예산 권한', b ? String(b.activeMandates) : '—', '유효한 내 목적별 한도'),
      metric('서버 일일 한도', b ? token(b.dailyLimitAtomic) : '—', '모든 결제 지갑 사용자에 적용'));
    if (!state.mandates.length) empty($('mandate-list'), state.wallet ? '만들어진 예산 권한이 없습니다.' : '로그인하면 예산 권한을 관리할 수 있습니다.');
    else $('mandate-list').replaceChildren(...state.mandates.map(m => {
      const card = el('article', null, 'saved-card'), head = el('div', null, 'saved-card-header');
      const label = { ACTIVE: '사용 가능', REVOKED: '취소됨', EXPIRED: '기한 만료', EXHAUSTED: '한도 도달' }[m.status] ?? '상태 확인';
      head.append(el('h3', m.purpose), el('span', label, 'state-pill')); card.append(head,
        el('p', short(m.wallet) + ' · ' + when(m.windowStart) + ' – ' + when(m.windowEnd)),
        el('small', '기한 ' + when(m.expiresAt) + ' · 버전 ' + m.version));
      const grid = el('div', null, 'mandate-limits');
      for (const [labelText, value] of [['남은 예산', token(m.remainingAtomic)], ['사용액', token(m.spentAtomic)], ['남은 실행', String(m.remainingExecutions)]]) { const n = el('div'); n.append(el('span', labelText), el('strong', value)); grid.append(n); }
      card.append(grid);
      if (m.status === 'ACTIVE') { const revoke = el('button', '이 예산 권한 취소', 'text-button'); revoke.type = 'button'; revoke.addEventListener('click', () => run('예산 권한 취소 중', async () => { await api('/api/mandates/' + encodeURIComponent(m.id) + '/revoke', 'POST', { expectedVersion: m.version }); await loadBudgets(); })); card.append(revoke); }
      return card;
    }));
    if (!b?.reservations?.length) empty($('reservation-list'), '아직 결제 예산 예약 기록이 없습니다.');
    else {
      const wrap = el('div', null, 'table-scroll'), table = el('table', null, 'ledger-table'), head = el('thead'), header = el('tr');
      ['작업', '금액 · 토큰', '상태', '예약한 날짜'].forEach(v => header.append(el('th', v))); head.append(header); table.append(head);
      const body = el('tbody'); for (const r of b.reservations) {
        const tr = el('tr'), cell = el('td'), open = el('button', short(r.taskId), 'text-button'); open.type = 'button'; open.addEventListener('click', () => selectTask(r.taskId)); cell.append(open);
        tr.append(cell, el('td', token(r.amountAtomic)), el('td', r.state === 'SPENT' ? '확인된 사용' : '예약 유지'), el('td', r.day)); body.append(tr);
      }
      table.append(body); wrap.append(table); $('reservation-list').replaceChildren(wrap);
    }
    controls();
  }
  async function loadBudgets() { const [result, dashboard] = await Promise.all([api('/api/mandates'), api('/api/dashboard')]); state.mandates = result.mandates; state.dashboard = dashboard; renderBudget(); renderConversation(); }
  async function loadActivity() { const result = await api('/api/activity?limit=50'); state.activities = result.events; renderActivity(); }
  function renderActivity() { if (!state.activities.length) empty($('activity-list'), state.wallet ? '대화와 기억을 저장하면 활동 기록이 나타납니다.' : '지갑 로그인 후 내 활동 기록을 확인할 수 있습니다.'); else $('activity-list').replaceChildren(...activityRows(state.activities)); }
  async function navigate(name) {
    if (!views[name]) return;
    const changed = state.view !== name; state.view = name;
    if (changed) { window.scrollTo({top:0,behavior:'instant'}); $('workspace-top').focus({preventScroll:true}); }
    document.querySelectorAll('[data-page]').forEach(n => { n.hidden = n.dataset.page !== name; });
    document.querySelectorAll('.shell-nav [data-view]').forEach(n => { if (n.dataset.view === name) n.setAttribute('aria-current', 'page'); else n.removeAttribute('aria-current'); });
    [$('view-eyebrow').textContent, $('view-title').textContent, $('view-description').textContent] = views[name];
    $('quick-new').hidden = name === 'assistant';
    if (state.wallet) {
      try {
        if (name === 'overview') await loadOverview();
        if (name === 'assistant') { const [list, mandates] = await Promise.all([loadConversations(), api('/api/mandates')]); state.mandates = mandates.mandates; renderConversation(); requestLinkedTask(); }
        if (name === 'memory') await loadMemory();
        if (name === 'budgets') await loadBudgets();
        if (name === 'activity') await loadActivity();
      } catch (error) { status(errorMessage(error), true); }
    }
    renderGuidedTask(); controls();
  }
  function selectTask(id) { navigate('tasks'); window.dispatchEvent(new CustomEvent('floww:select-task', { detail: { id } })); }
  document.querySelectorAll('[data-view]').forEach(n => n.addEventListener('click', () => navigate(n.dataset.view)));
  document.querySelectorAll('[data-go]').forEach(n => n.addEventListener('click', () => navigate(n.dataset.go)));
  $('quick-new').addEventListener('click', async () => { await navigate('assistant'); await run('대화 만드는 중', createConversation); });
  $('new-conversation').addEventListener('click', () => run('대화 만드는 중', createConversation));
  $('suggest-wallet').addEventListener('click', () => { $('message-text').value = '최근 지갑 이체를 자산별로 정리하고 싶어요.'; $('message-text').focus(); });
  $('more-conversations').addEventListener('click', () => run('이전 대화 불러오는 중', () => loadConversations(true)));
  $('earlier-messages').addEventListener('click', () => run('이전 메시지 불러오는 중', async () => {
    const c = state.conversation, prior = await api('/api/conversations/' + c.id + '?before=' + encodeURIComponent(c.previousMessages));
    if (state.conversation?.id === c.id) state.conversation = { ...c, messages: [...prior.messages, ...c.messages], previousMessages: prior.previousMessages };
  }));
  async function planCurrent() {
    const c = state.conversation, key = c.id + ':' + c.intentRevision;
    state.stage = 'planning'; status('필요한 자료와 계획을 검토 중…'); renderJourney();
    if (state.pendingPlan?.key !== key) state.pendingPlan = { key, clientRequestId: crypto.randomUUID(), expectedRevision: c.revision };
    try { state.conversation = await api('/api/conversations/' + c.id + '/plan', 'POST', { clientRequestId: state.pendingPlan.clientRequestId, expectedRevision: state.pendingPlan.expectedRevision }); state.pendingPlan = null; }
    catch (error) { if (error.status) state.pendingPlan = null; throw error; }
  }
  $('message-form').addEventListener('submit', event => {
    event.preventDefault(); if (!$('message-form').reportValidity()) return;
    if (!state.authReady) { status('로그인 연결을 확인하고 있습니다. 입력한 내용은 유지합니다.'); return; }
    if (!state.wallet) {
      state.guestPending = { text: $('message-text').value, wallet: $('intent-wallet').value, start: $('intent-start').value, end: $('intent-end').value };
      status('요청 내용을 유지합니다. 지갑 로그인 후 이어갑니다.'); $('connect-wallet').click(); return;
    }
    run('목적과 조회 범위 확인 중', async () => {
      const text = $('message-text').value.trim(), scope = explicitScope();
      if (!state.conversation) await createConversation();
      state.stage = 'refining'; renderJourney();
      const c = state.conversation, key = JSON.stringify({ text, scope, id: c.id });
      if (state.pendingMessage?.key !== key) state.pendingMessage = { key, clientRequestId: crypto.randomUUID(), expectedRevision: c.revision };
      const body = { text, scope, clientRequestId: state.pendingMessage.clientRequestId, expectedRevision: state.pendingMessage.expectedRevision };
      try { state.conversation = await api('/api/conversations/' + c.id + '/messages', 'POST', body); state.pendingMessage = null; }
      catch (error) { if (error.status) state.pendingMessage = null; throw error; }
      $('message-text').value = ''; syncScope(); renderConversation();
      if (state.conversation.status === 'READY_TO_PLAN' && !state.conversation.plan && !state.conversation.working) await planCurrent();
      await loadConversations();
    }, { refreshConversation: true });
  });
  $('build-plan').addEventListener('click', () => run('계획 작성 및 검토 중', async () => { await planCurrent(); await loadConversations(); }, { refreshConversation: true }));
  for (const id of ['intent-wallet', 'intent-start', 'intent-end']) $(id).addEventListener('input', () => { controls(); renderJourney(); });
  $('confirm-plan-form').addEventListener('submit', event => {
    event.preventDefault(); if (!$('confirm-plan-form').reportValidity()) return;
    run('확인한 범위의 결제 조건 준비 중', async () => {
      const c = state.conversation, scope = c.plan.scope, mandateId = $('plan-mandate').value;
      if (planScopeChanged()) throw { code: 'PLAN_SCOPE_CHANGED' };
      const task = await api('/api/conversations/' + c.id + '/confirm', 'POST', { expectedRevision: c.revision, planHash: c.plan.hash,
        wallet: scope.wallet, windowStart: scope.windowStart, windowEnd: scope.windowEnd, ...(mandateId ? { mandateId } : {}), acknowledge: true });
      state.conversation = await api('/api/conversations/' + c.id); await loadConversations();
      window.dispatchEvent(new CustomEvent('floww:select-task', { detail: { id: task.id, prepareQuote: true } }));
    }, { refreshConversation: true });
  });
  $('memory-form').addEventListener('submit', event => {
    event.preventDefault(); if (!$('memory-form').reportValidity()) return;
    run('기억 저장 중', async () => { const date = new Date($('memory-expiry').value + 'T12:00:00');
      await api('/api/memories', 'POST', { key: $('memory-key').value.trim(), value: $('memory-value').value.trim(), expiresAt: date.toISOString(), acknowledge: $('memory-ack').checked });
      $('memory-key').value = ''; $('memory-value').value = ''; $('memory-ack').checked = false; await loadMemory();
    });
  });
  $('refresh-memory').addEventListener('click', () => run('기억 불러오는 중', loadMemory));
  $('more-memory').addEventListener('click', () => run('기억 더 불러오는 중', () => loadMemory(true)));
  $('mandate-form').addEventListener('submit', event => {
    event.preventDefault(); if (!$('mandate-form').reportValidity()) return;
    run('예산 권한 저장 중', async () => {
      const value = { purpose: $('mandate-purpose').value.trim(), wallet: $('mandate-wallet').value.trim(),
        windowStart: new Date($('mandate-start').value).toISOString(), windowEnd: new Date($('mandate-end').value).toISOString(),
        budgetAtomic: window.FlowwUnits.parse($('mandate-total').value.trim(), 6), perPurchaseAtomic: window.FlowwUnits.parse($('mandate-per').value.trim(), 6),
        maxExecutions: Number($('mandate-count').value), expiresAt: new Date($('mandate-expiry').value).toISOString(), acknowledge: $('mandate-ack').checked };
      await api('/api/mandates', 'POST', value); $('mandate-ack').checked = false; await loadBudgets();
    });
  });
  $('refresh-mandates').addEventListener('click', () => run('예산 권한 불러오는 중', loadBudgets));
  $('refresh-activity').addEventListener('click', () => run('활동 불러오는 중', loadActivity));
  window.addEventListener('floww:session', event => {
    state.health = event.detail?.health;
    state.authReady = event.detail?.initializing !== true;
    if (state.wallet === event.detail?.wallet) { controls(); return; }
    const firstLogin = !state.wallet && Boolean(event.detail?.wallet);
    const draft = firstLogin ? { text: $('message-text').value, wallet: $('intent-wallet').value, start: $('intent-start').value, end: $('intent-end').value } : null;
    const queued = state.guestPending; state.guestPending = null;
    state.wallet = event.detail?.wallet ?? null; state.epoch++; state.busy = false; state.taskBusy = false; state.selectedTask = null; state.stage = null;
    state.conversation = null; state.conversations = []; state.conversationCursor = null; state.memories = []; state.memoryCursor = null;
    state.mandates = []; state.dashboard = null; state.catalog = []; state.activities = []; state.tasks = [];
    state.pendingMessage = null; state.pendingPlan = null;
    $('message-text').value = ''; $('memory-key').value = ''; $('memory-value').value = ''; $('memory-ack').checked = false;
    $('mandate-form').reset(); $('conversation-memory').checked = false;
    $('mandate-start').value = local(Date.now() - 86_400_000); $('mandate-end').value = local(Date.now() - 1000); $('mandate-expiry').value = local(Date.now() + 30 * 86_400_000 - 60_000);
    $('memory-expiry').value = local(Date.now() + 30 * 86_400_000).slice(0, 10);
    syncScope(); status(''); renderOverview(); renderConversationList(); renderConversation(); renderMemory(); renderBudget(); renderActivity();
    navigate(state.view);
    if (draft?.text) {
      $('message-text').value = draft.text; $('intent-wallet').value = draft.wallet; $('intent-start').value = draft.start; $('intent-end').value = draft.end;
      if (queued && JSON.stringify(queued) === JSON.stringify(draft)) $('message-form').requestSubmit();
    }
  });
  window.addEventListener('floww:selection', event => {
    if (!state.wallet || event.detail?.wallet !== state.wallet) return;
    state.selectedTask = event.detail.task ?? null; state.taskBusy = event.detail.busy === true; renderJourney(); controls();
  });
  let refreshTimer;
  window.addEventListener('floww:task-updated', () => {
    clearTimeout(refreshTimer); if (!state.wallet || state.view !== 'overview') return;
    refreshTimer = setTimeout(() => loadOverview().catch(() => {}), 250);
  });
  window.addEventListener('pagehide', () => clearTimeout(refreshTimer), { once: true });
  const today = new Date(), month = new Date(today.getTime() + 30 * 86_400_000);
  $('memory-expiry').value = local(month).slice(0, 10); $('memory-expiry').min = local(today).slice(0, 10); $('memory-expiry').max = local(today.getTime() + 89 * 86_400_000).slice(0, 10);
  $('mandate-start').value = local(today.getTime() - 86_400_000); $('mandate-end').value = local(today.getTime() - 1000); $('mandate-expiry').value = local(month.getTime() - 60_000);
  renderOverview(); renderConversationList(); renderConversation(); renderMemory(); renderBudget(); renderActivity(); controls();
  navigate('assistant');
  window.dispatchEvent(new CustomEvent('floww:session-refresh'));
})();
