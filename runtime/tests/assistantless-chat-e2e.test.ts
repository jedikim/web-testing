import { describe, expect, it } from 'vitest';

import { runAssistantlessChatE2E } from '../src/testing/assistantless-chat-e2e';

describe('runAssistantlessChatE2E', () => {
  it('runs first step with llm then minimizes llm calls via rule path', async () => {
    const shared: Array<{ step: number; stage: 'before' | 'after' }> = [];
    let llmCalls = 0;
    let ruleCalls = 0;
    let actionCount = 0;

    const result = await runAssistantlessChatE2E({
      goal: '네이버에서 뉴스 검색 자동화',
      llmWarmupSteps: 1,
      maxSteps: 5,
      captureScreenshot: async ({ step, stage }) => `runs/${step}-${stage}.png`,
      shareWithUser: async (snapshot) => {
        shared.push({ step: snapshot.step, stage: snapshot.stage });
      },
      analyzeWithLlm: async () => {
        llmCalls += 1;
        return { kind: 'type', target: 'input[name=query]', value: '뉴스' };
      },
      decideWithRules: async () => {
        ruleCalls += 1;
        return { kind: 'click', target: 'button.search' };
      },
      executeAction: async () => {
        actionCount += 1;
        if (actionCount === 3) {
          return { status: 'pass', done: true };
        }
        return { status: 'pass', done: false };
      },
      askUserDecision: async () => 'go'
    });

    expect(result.status).toBe('pass');
    expect(result.steps).toBe(3);
    expect(result.llmCalls).toBe(1);
    expect(result.ruleCalls).toBe(2);
    expect(result.visionCalls).toBe(0);
    expect(result.snapshotsShared).toBe(6);
    expect(shared).toHaveLength(6);
    expect(llmCalls).toBe(1);
    expect(ruleCalls).toBe(2);
  });

  it('uses vision hint and llm revision after a failure', async () => {
    let llmCalls = 0;
    let visionCalls = 0;
    let actionCount = 0;

    const result = await runAssistantlessChatE2E({
      goal: '다음에서 뉴스 탭으로 이동',
      llmWarmupSteps: 1,
      maxSteps: 4,
      captureScreenshot: async ({ step, stage }) => `runs/revise-${step}-${stage}.png`,
      shareWithUser: async () => undefined,
      analyzeWithLlm: async () => {
        llmCalls += 1;
        return { kind: 'click', target: '#news-tab' };
      },
      decideWithRules: async () => ({ kind: 'click', target: '#news-tab' }),
      detectWithVision: async () => {
        visionCalls += 1;
        return { model: 'yolo26n', target: '#news-tab-v2', confidence: 0.84 };
      },
      executeAction: async () => {
        actionCount += 1;
        if (actionCount === 1) {
          return {
            status: 'fail',
            reason: 'selector drift',
            userQuestion: '탭 위치가 바뀌었습니다. 수정 후 재시도할까요?'
          };
        }
        return { status: 'pass', done: true };
      },
      askUserDecision: async () => 'revise'
    });

    expect(result.status).toBe('pass');
    expect(result.revisions).toBe(1);
    expect(result.decisions).toEqual(['revise']);
    expect(result.llmCalls).toBe(2);
    expect(result.visionCalls).toBe(1);
    expect(llmCalls).toBe(2);
    expect(visionCalls).toBe(1);
  });

  it('blocks when user decides not_go after failure', async () => {
    const result = await runAssistantlessChatE2E({
      goal: '민감 액션 제출',
      llmWarmupSteps: 1,
      maxSteps: 3,
      captureScreenshot: async ({ step, stage }) => `runs/block-${step}-${stage}.png`,
      shareWithUser: async () => undefined,
      analyzeWithLlm: async () => ({ kind: 'click', target: 'button.submit' }),
      decideWithRules: async () => ({ kind: 'click', target: 'button.submit' }),
      executeAction: async () => ({
        status: 'fail',
        reason: 'needs human confirmation',
        userQuestion: '제출 버튼을 누를까요?'
      }),
      askUserDecision: async () => 'not_go'
    });

    expect(result.status).toBe('blocked');
    expect(result.decisions).toEqual(['not_go']);
    expect(result.revisions).toBe(0);
    expect(result.steps).toBe(1);
  });
});
