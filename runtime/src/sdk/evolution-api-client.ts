import type {
  ApproveEvolutionJobInput,
  CreateEvolutionJobInput,
  EvolutionJobDiffSnapshot,
  EvolutionVersionSummary,
  JobProgressSnapshot,
  RejectEvolutionJobInput
} from '../evolution/types';

interface JsonPayload<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface EvolutionApiClientOptions {
  baseUrl: string;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
}

export interface WaitForTerminalOptions {
  timeoutMs?: number;
  intervalMs?: number;
}

function isTerminal(status: string): boolean {
  return status === 'promoted' || status === 'rejected' || status === 'failed';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class EvolutionApiClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: typeof fetch;

  constructor(options: EvolutionApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.headers = options.headers ?? {};
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...this.headers,
        ...(init?.headers ?? {})
      }
    });

    const payload = (await response.json()) as JsonPayload<T>;
    if (!response.ok || !payload.ok || payload.data === undefined) {
      throw new Error(payload.error ?? `request failed with status ${response.status}`);
    }
    return payload.data;
  }

  async health(): Promise<{ status: string }> {
    return this.request('/health', { method: 'GET' });
  }

  async listJobs(): Promise<JobProgressSnapshot['job'][]> {
    return this.request('/evolution/jobs', { method: 'GET' });
  }

  async createJob(input: CreateEvolutionJobInput): Promise<JobProgressSnapshot> {
    return this.request('/evolution/jobs', {
      method: 'POST',
      body: JSON.stringify(input)
    });
  }

  async getSnapshot(jobId: string): Promise<JobProgressSnapshot> {
    return this.request(`/evolution/jobs/${encodeURIComponent(jobId)}`, {
      method: 'GET'
    });
  }

  async getJobDiff(jobId: string): Promise<EvolutionJobDiffSnapshot> {
    return this.request(`/evolution/jobs/${encodeURIComponent(jobId)}/diff`, {
      method: 'GET'
    });
  }

  async listVersionSummaries(): Promise<EvolutionVersionSummary[]> {
    return this.request('/evolution/versions', { method: 'GET' });
  }

  async getVersionSummary(workflowId: string): Promise<EvolutionVersionSummary> {
    return this.request(`/evolution/versions/${encodeURIComponent(workflowId)}`, {
      method: 'GET'
    });
  }

  async getCurrentVersion(
    workflowId: string
  ): Promise<EvolutionVersionSummary['current'] | undefined> {
    return this.request(
      `/evolution/versions/${encodeURIComponent(workflowId)}/current`,
      {
        method: 'GET'
      }
    );
  }

  async getVersionHistory(workflowId: string): Promise<EvolutionVersionSummary['history']> {
    return this.request(
      `/evolution/versions/${encodeURIComponent(workflowId)}/history`,
      {
        method: 'GET'
      }
    );
  }

  async approveJob(jobId: string, input: ApproveEvolutionJobInput): Promise<JobProgressSnapshot> {
    return this.request(`/evolution/jobs/${encodeURIComponent(jobId)}/approve`, {
      method: 'POST',
      body: JSON.stringify(input)
    });
  }

  async rejectJob(jobId: string, input: RejectEvolutionJobInput): Promise<JobProgressSnapshot> {
    return this.request(`/evolution/jobs/${encodeURIComponent(jobId)}/reject`, {
      method: 'POST',
      body: JSON.stringify(input)
    });
  }

  async retryJob(jobId: string): Promise<JobProgressSnapshot> {
    return this.request(`/evolution/jobs/${encodeURIComponent(jobId)}/retry`, {
      method: 'POST',
      body: JSON.stringify({})
    });
  }

  async waitForTerminal(
    jobId: string,
    options: WaitForTerminalOptions = {}
  ): Promise<JobProgressSnapshot> {
    const timeoutMs = options.timeoutMs ?? 10 * 60_000;
    const intervalMs = options.intervalMs ?? 2_000;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() <= deadline) {
      const snapshot = await this.getSnapshot(jobId);
      if (isTerminal(snapshot.job.status)) {
        return snapshot;
      }
      await delay(intervalMs);
    }

    throw new Error(`timeout waiting for terminal state for job ${jobId}`);
  }
}

export function createEvolutionApiClient(options: EvolutionApiClientOptions): EvolutionApiClient {
  return new EvolutionApiClient(options);
}
