const state = {
  currentSessionId: null,
  sessions: []
};

const sessionListEl = document.getElementById('sessionList');
const turnsEl = document.getElementById('turns');
const statusEl = document.getElementById('status');

const titleInput = document.getElementById('titleInput');
const modeInput = document.getElementById('modeInput');
const workflowInput = document.getElementById('workflowInput');
const messageInput = document.getElementById('messageInput');
const screenshotInput = document.getElementById('screenshotInput');

const createBtn = document.getElementById('createBtn');
const refreshBtn = document.getElementById('refreshBtn');
const sendBtn = document.getElementById('sendBtn');
const closeBtn = document.getElementById('closeBtn');

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

async function request(path, init) {
  const response = await fetch(path, {
    headers: {
      'content-type': 'application/json'
    },
    ...init
  });

  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }

  return payload.data;
}

function renderSessions() {
  sessionListEl.innerHTML = '';

  for (const session of state.sessions) {
    const li = document.createElement('li');
    li.className = `session${session.id === state.currentSessionId ? ' active' : ''}`;
    li.innerHTML = `
      <div><strong>${escapeHtml(session.title || session.id)}</strong></div>
      <div class="meta">${escapeHtml(session.mode)} | ${escapeHtml(session.status)}</div>
      <div class="meta">turns: ${session.turns.length}</div>
    `;
    li.addEventListener('click', () => {
      state.currentSessionId = session.id;
      renderSessions();
      renderTurns(session);
    });

    sessionListEl.appendChild(li);
  }

  if (!state.currentSessionId && state.sessions.length > 0) {
    state.currentSessionId = state.sessions[0].id;
    renderSessions();
    renderTurns(state.sessions[0]);
  }
}

function renderTurns(session) {
  statusEl.textContent = `Session: ${session.id} (${session.status})`;

  turnsEl.innerHTML = session.turns
    .map(
      (turn) => `
      <article class="turn">
        <div class="meta"><span class="role">${escapeHtml(turn.role)}</span> | ${escapeHtml(turn.at)}</div>
        <div>${escapeHtml(turn.content).replaceAll('\n', '<br/>')}</div>
        ${turn.screenshotPath ? `<div class="meta">screenshot: ${escapeHtml(turn.screenshotPath)}</div>` : ''}
      </article>
    `
    )
    .join('');

  turnsEl.scrollTop = turnsEl.scrollHeight;
}

async function reloadSessions() {
  state.sessions = await request('/backend/sessions', { method: 'GET' });
  renderSessions();

  if (state.currentSessionId) {
    const active = state.sessions.find((item) => item.id === state.currentSessionId);
    if (active) {
      renderTurns(active);
    }
  }
}

async function createSession() {
  const created = await request('/backend/sessions', {
    method: 'POST',
    body: JSON.stringify({
      mode: modeInput.value,
      title: titleInput.value.trim() || undefined,
      workflowId: workflowInput.value.trim() || undefined
    })
  });

  state.currentSessionId = created.id;
  await reloadSessions();
}

async function sendMessage() {
  const sessionId = state.currentSessionId;
  if (!sessionId) {
    throw new Error('Select or create a session first');
  }

  const content = messageInput.value.trim();
  if (!content) {
    throw new Error('Message is empty');
  }

  await request(`/backend/sessions/${encodeURIComponent(sessionId)}/turns`, {
    method: 'POST',
    body: JSON.stringify({
      content,
      screenshotPath: screenshotInput.value.trim() || undefined
    })
  });

  messageInput.value = '';
  await reloadSessions();
}

async function closeSession() {
  const sessionId = state.currentSessionId;
  if (!sessionId) {
    throw new Error('Select a session first');
  }

  await request(`/backend/sessions/${encodeURIComponent(sessionId)}/close`, {
    method: 'POST',
    body: JSON.stringify({})
  });

  await reloadSessions();
}

function bind(button, handler) {
  button.addEventListener('click', async () => {
    statusEl.textContent = 'Processing...';
    try {
      await handler();
      const active = state.sessions.find((item) => item.id === state.currentSessionId);
      if (active) {
        statusEl.textContent = `Session: ${active.id} (${active.status})`;
      } else {
        statusEl.textContent = 'Ready';
      }
    } catch (error) {
      statusEl.textContent = `Error: ${error.message}`;
    }
  });
}

bind(createBtn, createSession);
bind(refreshBtn, reloadSessions);
bind(sendBtn, sendMessage);
bind(closeBtn, closeSession);

reloadSessions().catch((error) => {
  statusEl.textContent = `Error: ${error.message}`;
});
