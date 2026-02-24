import { resolve } from 'node:path';

import { BackendSimpleService, type SendUserTurnInput, type SendUserTurnOutput } from '../backend/simple-backend-service';
import type { MultiTurnEngine } from '../session/engine';
import { buildDefaultTurnEngine } from '../session/engine';
import { SessionStore } from '../session/store';
import type { AutomationSession, CreateSessionInput } from '../session/types';
import type { AutomationFullFlowInput } from '../testing/automation-full-flow';

import {
  createWebAutomationSdk,
  type RunWithImprovementOutput,
  type WebAutomationSdk
} from './automation-sdk';

export interface MultiTurnAutomationSdkOptions {
  service?: BackendSimpleService;
  store?: SessionStore;
  sessionRootDir?: string;
  engine?: MultiTurnEngine;
  webAutomationSdk?: WebAutomationSdk;
}

export interface MultiTurnSendInput extends SendUserTurnInput {
  automation?: AutomationFullFlowInput;
}

export interface MultiTurnSendOutput extends SendUserTurnOutput {
  automation?: RunWithImprovementOutput;
}

function defaultSessionRoot(): string {
  return resolve(process.cwd(), 'testing', 'backend', 'state');
}

function summarizeAutomation(output: RunWithImprovementOutput): Record<string, unknown> {
  return {
    finalStatus: output.flow.finalStatus,
    deterministicStatus: output.flow.deterministic.status,
    failureCount: output.flow.deterministic.failures.length,
    improvementTriggered: output.improvement?.triggered ?? false,
    improvementReason: output.improvement?.reason,
    improvementJobId: output.improvement?.completed?.job.id
  };
}

export class MultiTurnAutomationSdk {
  private readonly service: BackendSimpleService;
  private readonly webAutomationSdk: WebAutomationSdk;

  constructor(options: MultiTurnAutomationSdkOptions = {}) {
    if (options.service) {
      this.service = options.service;
    } else {
      const store =
        options.store ??
        new SessionStore({
          rootDir: options.sessionRootDir ?? defaultSessionRoot()
        });

      this.service = new BackendSimpleService({
        store,
        engine:
          options.engine ??
          buildDefaultTurnEngine({
            useGemini: process.env.BACKEND_LLM_ENABLED === '1'
          })
      });
    }

    this.webAutomationSdk = options.webAutomationSdk ?? createWebAutomationSdk();
  }

  async createSession(input: CreateSessionInput = {}): Promise<AutomationSession> {
    return this.service.createSession({
      mode: input.mode ?? 'sdk_detailed',
      ...input
    });
  }

  async listSessions(): Promise<AutomationSession[]> {
    return this.service.listSessions();
  }

  async getSession(sessionId: string): Promise<AutomationSession> {
    return this.service.getSession(sessionId);
  }

  async closeSession(sessionId: string): Promise<AutomationSession> {
    return this.service.closeSession(sessionId);
  }

  async sendUserTurn(input: MultiTurnSendInput): Promise<MultiTurnSendOutput> {
    const metadata = {
      ...(input.metadata ?? {})
    };

    let automation: RunWithImprovementOutput | undefined;
    if (input.automation) {
      automation = await this.webAutomationSdk.runWithImprovement(input.automation);
      metadata.automation = summarizeAutomation(automation);
    }

    const result = await this.service.sendUserTurn({
      sessionId: input.sessionId,
      content: input.content,
      screenshotPath: input.screenshotPath,
      metadata
    });

    return {
      ...result,
      automation
    };
  }
}

export function createMultiTurnAutomationSdk(
  options: MultiTurnAutomationSdkOptions = {}
): MultiTurnAutomationSdk {
  return new MultiTurnAutomationSdk(options);
}
