export type SessionMode = 'backend_simple' | 'sdk_detailed';

export type SessionStatus = 'active' | 'closed';

export type SessionTurnRole = 'system' | 'user' | 'assistant' | 'tool';

export interface SessionTurn {
  id: string;
  role: SessionTurnRole;
  content: string;
  at: string;
  screenshotPath?: string;
  metadata?: Record<string, unknown>;
}

export interface AutomationSession {
  id: string;
  mode: SessionMode;
  status: SessionStatus;
  workflowId?: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  turns: SessionTurn[];
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface CreateSessionInput {
  mode?: SessionMode;
  workflowId?: string;
  title?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  systemPrompt?: string;
}

export interface AddSessionTurnInput {
  role: SessionTurnRole;
  content: string;
  screenshotPath?: string;
  metadata?: Record<string, unknown>;
}
