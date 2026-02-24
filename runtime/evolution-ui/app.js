const jobsPane = document.getElementById('jobsPane');
const snapshotPane = document.getElementById('snapshotPane');
const status = document.getElementById('status');
const activeJobId = document.getElementById('activeJobId');

let stream;

function value(id) {
  const element = document.getElementById(id);
  return element ? element.value : '';
}

function renderSnapshot(snapshot) {
  snapshotPane.textContent = JSON.stringify(snapshot, null, 2);
  const nextStatus = snapshot?.job?.status ?? '-';
  status.textContent = nextStatus;
  status.className = `status ${nextStatus}`;
  if (snapshot?.job?.id) {
    activeJobId.value = snapshot.job.id;
  }
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...options
  });
  const json = await response.json();
  if (!json.ok) {
    throw new Error(json.error ?? 'request failed');
  }
  return json.data;
}

async function refreshJobs() {
  const jobs = await request('/evolution/jobs');
  jobsPane.textContent = JSON.stringify(jobs, null, 2);
}

async function createJob() {
  const payload = {
    title: value('title'),
    trigger: value('trigger'),
    workflowId: value('workflowId'),
    requestedBy: value('requestedBy'),
    testCommand: value('testCommand'),
    maxAutoFixAttempts: Number(value('maxAutoFixAttempts')),
    notes: value('notes')
  };

  const snapshot = await request('/evolution/jobs', {
    method: 'POST',
    body: JSON.stringify(payload)
  });

  renderSnapshot(snapshot);
  await refreshJobs();
}

function watchJob() {
  if (stream) {
    stream.close();
    stream = undefined;
  }
  const jobId = value('activeJobId');
  if (!jobId) {
    return;
  }

  stream = new EventSource(`/evolution/jobs/${jobId}/stream`);
  stream.addEventListener('snapshot', (event) => {
    const snapshot = JSON.parse(event.data);
    renderSnapshot(snapshot);
  });

  stream.onerror = () => {
    status.textContent = 'stream-error';
  };
}

async function act(path, payload) {
  const snapshot = await request(path, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  renderSnapshot(snapshot);
  await refreshJobs();
}

document.getElementById('createBtn')?.addEventListener('click', () => {
  createJob().catch((error) => alert(error.message));
});

document.getElementById('refreshBtn')?.addEventListener('click', () => {
  refreshJobs().catch((error) => alert(error.message));
});

document.getElementById('watchBtn')?.addEventListener('click', () => {
  watchJob();
});

document.getElementById('approveBtn')?.addEventListener('click', () => {
  const jobId = value('activeJobId');
  if (!jobId) {
    return;
  }
  act(`/evolution/jobs/${jobId}/approve`, {
    confirmedBy: 'ui-tester',
    note: 'looks good'
  }).catch((error) => alert(error.message));
});

document.getElementById('rejectBtn')?.addEventListener('click', () => {
  const jobId = value('activeJobId');
  if (!jobId) {
    return;
  }
  act(`/evolution/jobs/${jobId}/reject`, {
    rejectedBy: 'ui-tester',
    reason: 'manual rejection for test'
  }).catch((error) => alert(error.message));
});

document.getElementById('retryBtn')?.addEventListener('click', () => {
  const jobId = value('activeJobId');
  if (!jobId) {
    return;
  }
  act(`/evolution/jobs/${jobId}/retry`, {}).catch((error) => alert(error.message));
});

refreshJobs().catch((error) => {
  jobsPane.textContent = `failed to load jobs: ${error.message}`;
});
