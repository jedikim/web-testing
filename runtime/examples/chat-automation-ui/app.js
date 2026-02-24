const state = {
  sessions: [],
  selectedSessionId: null,
  snapshot: null,
  stream: null,
  refreshTimer: null
};

const sessionListEl = document.getElementById('sessionList');
const newSessionBtn = document.getElementById('newSessionBtn');
const operatorInput = document.getElementById('operatorInput');

const sessionTitleEl = document.getElementById('sessionTitle');
const sessionMetaEl = document.getElementById('sessionMeta');
const statusBadgeEl = document.getElementById('statusBadge');
const progressTextEl = document.getElementById('progressText');
const queueTextEl = document.getElementById('queueText');

const turnsEl = document.getElementById('turns');
const logsEl = document.getElementById('logs');

const pauseBtn = document.getElementById('pauseBtn');
const resumeBtn = document.getElementById('resumeBtn');
const cancelBtn = document.getElementById('cancelBtn');

const captchaBoxEl = document.getElementById('captchaBox');
const captchaPromptEl = document.getElementById('captchaPrompt');
const captchaInputEl = document.getElementById('captchaInput');
const submitCaptchaBtn = document.getElementById('submitCaptchaBtn');

const browserModeSelect = document.getElementById('browserModeSelect');
const autoPauseCheckbox = document.getElementById('autoPauseCheckbox');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

async function request(path, init = {}) {
  const response = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init.headers || {})
    }
  });

  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }

  return payload.data;
}

function setBadge(status) {
  statusBadgeEl.textContent = status;
  statusBadgeEl.className = `badge ${status}`;
}

function renderTurns(turns = []) {
  turnsEl.innerHTML = turns
    .map(
      (turn) => `
      <div class="turn">
        <div class="role">${escapeHtml(turn.role)} <span class="muted">${escapeHtml(turn.at)}</span></div>
        <div>${escapeHtml(turn.content).replaceAll('\n', '<br/>')}</div>
      </div>
    `
    )
    .join('');
  turnsEl.scrollTop = turnsEl.scrollHeight;
}

function renderLogs(logs = []) {
  logsEl.innerHTML = logs
    .map((log) => `[${log.at}] [${String(log.level).toUpperCase()}] ${escapeHtml(log.message)}`)
    .join('\n');
  logsEl.scrollTop = logsEl.scrollHeight;
}

function renderSnapshot() {
  const snapshot = state.snapshot;
  if (!snapshot) {
    sessionTitleEl.textContent = 'No session selected';
    sessionMetaEl.textContent = 'Create a session to start.';
    setBadge('idle');
    progressTextEl.textContent = 'step 0/0';
    queueTextEl.textContent = 'queue: 0';
    renderTurns([]);
    renderLogs([]);
    captchaBoxEl.classList.add('hidden');
    return;
  }

  const session = snapshot.session;
  const run = snapshot.run;

  sessionTitleEl.textContent = session.title || session.id;
  sessionMetaEl.textContent = `${session.id} | operator=${session.metadata?.operatorId || 'default-operator'}`;
  setBadge(run.status);
  progressTextEl.textContent = `step ${run.step}/${run.totalSteps}`;
  queueTextEl.textContent = `queue: ${run.queueLength}`;

  renderTurns(session.turns || []);
  renderLogs(snapshot.logs || []);

  const waitingCaptcha = run.waitingCaptcha || run.status === 'waiting_captcha';
  if (waitingCaptcha) {
    captchaBoxEl.classList.remove('hidden');
    captchaPromptEl.textContent = run.captchaPrompt || 'Captcha/security input required.';
  } else {
    captchaBoxEl.classList.add('hidden');
  }

  const selectedStatus = run.status;
  pauseBtn.disabled = !(selectedStatus === 'running' || selectedStatus === 'waiting_captcha');
  resumeBtn.disabled = selectedStatus !== 'paused';
  cancelBtn.disabled = selectedStatus === 'idle' || selectedStatus === 'completed' || selectedStatus === 'canceled';
}

function renderSessions() {
  sessionListEl.innerHTML = state.sessions
    .map(
      (session) => `
      <li class="session-item ${session.sessionId === state.selectedSessionId ? 'active' : ''}" data-id="${escapeHtml(session.sessionId)}">
        <div><strong>${escapeHtml(session.title || session.sessionId)}</strong></div>
        <div class="muted">${escapeHtml(session.operatorId)} | ${escapeHtml(session.runStatus)}</div>
        <div class="muted">queue: ${session.queueLength}</div>
      </li>
    `
    )
    .join('');

  for (const row of sessionListEl.querySelectorAll('.session-item')) {
    row.addEventListener('click', () => {
      const id = row.getAttribute('data-id');
      if (id) {
        selectSession(id);
      }
    });
  }
}

function closeStream() {
  if (state.stream) {
    state.stream.close();
    state.stream = null;
  }
}

async function selectSession(sessionId) {
  state.selectedSessionId = sessionId;
  renderSessions();

  closeStream();
  const snapshot = await request(`/example/chat/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'GET'
  });
  state.snapshot = snapshot;
  renderSnapshot();

  const stream = new EventSource(`/example/chat/sessions/${encodeURIComponent(sessionId)}/stream`);
  stream.addEventListener('snapshot', (event) => {
    try {
      state.snapshot = JSON.parse(event.data);
      renderSnapshot();
      refreshSessions().catch(() => undefined);
    } catch (error) {
      console.error(error);
    }
  });
  stream.onerror = () => {
    stream.close();
    setTimeout(() => {
      if (state.selectedSessionId === sessionId) {
        selectSession(sessionId).catch((error) => console.error(error));
      }
    }, 1500);
  };
  state.stream = stream;
}

async function refreshSessions() {
  state.sessions = await request('/example/chat/sessions', { method: 'GET' });

  if (!state.selectedSessionId && state.sessions.length > 0) {
    state.selectedSessionId = state.sessions[0].sessionId;
  }

  renderSessions();

  if (state.selectedSessionId && !state.sessions.find((s) => s.sessionId === state.selectedSessionId)) {
    state.selectedSessionId = state.sessions.length > 0 ? state.sessions[0].sessionId : null;
  }
}

async function createSession() {
  const title = window.prompt('Session title', 'chat automation session');
  if (!title) {
    return;
  }

  const data = await request('/example/chat/sessions', {
    method: 'POST',
    body: JSON.stringify({
      title,
      operatorId: operatorInput.value.trim() || 'default-operator',
      systemPrompt: 'Use deterministic-first. Ask for captcha/security input via user handoff.'
    })
  });

  state.selectedSessionId = data.session.id;
  await refreshSessions();
  await selectSession(data.session.id);
}

async function sendMessage() {
  const sessionId = state.selectedSessionId;
  if (!sessionId) {
    throw new Error('Select or create a session first');
  }

  const content = messageInput.value.trim();
  if (!content) {
    throw new Error('Message is empty');
  }

  await request(`/example/chat/sessions/${encodeURIComponent(sessionId)}/message`, {
    method: 'POST',
    body: JSON.stringify({
      content,
      browserMode: browserModeSelect.value,
      operatorId: operatorInput.value.trim() || 'default-operator',
      autoPauseOthers: autoPauseCheckbox.checked
    })
  });

  messageInput.value = '';
}

async function postAction(action) {
  const sessionId = state.selectedSessionId;
  if (!sessionId) {
    throw new Error('No selected session');
  }

  await request(`/example/chat/sessions/${encodeURIComponent(sessionId)}/${action}`, {
    method: 'POST',
    body: JSON.stringify({})
  });
}

async function submitCaptcha() {
  const sessionId = state.selectedSessionId;
  if (!sessionId) {
    throw new Error('No selected session');
  }

  const value = captchaInputEl.value.trim();
  if (!value) {
    throw new Error('Captcha value is empty');
  }

  await request(`/example/chat/sessions/${encodeURIComponent(sessionId)}/captcha`, {
    method: 'POST',
    body: JSON.stringify({ value })
  });

  captchaInputEl.value = '';
}

function bindAsync(element, fn) {
  element.addEventListener('click', async () => {
    element.disabled = true;
    try {
      await fn();
      await refreshSessions();
    } catch (error) {
      window.alert(error.message);
    } finally {
      element.disabled = false;
    }
  });
}

bindAsync(newSessionBtn, createSession);
bindAsync(sendBtn, sendMessage);
bindAsync(pauseBtn, () => postAction('pause'));
bindAsync(resumeBtn, () => postAction('resume'));
bindAsync(cancelBtn, () => postAction('cancel'));
bindAsync(submitCaptchaBtn, submitCaptcha);

refreshSessions()
  .then(async () => {
    if (state.selectedSessionId) {
      await selectSession(state.selectedSessionId);
    } else {
      renderSnapshot();
    }
  })
  .catch((error) => {
    console.error(error);
    window.alert(error.message);
  });

state.refreshTimer = setInterval(() => {
  refreshSessions().catch(() => undefined);
}, 3000);

window.addEventListener('beforeunload', () => {
  closeStream();
  if (state.refreshTimer) {
    clearInterval(state.refreshTimer);
  }
});
