import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { Jimp } from 'jimp';

import { runAssistantlessChatE2E } from '../src/testing/assistantless-chat-e2e';

async function makeImage(path: string, color: number): Promise<void> {
  const image = new Jimp({ width: 48, height: 48, color });
  await image.write(path as `${string}.${string}`);
}

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
    expect(result.repeatedItemCompositeBuilds).toBe(0);
    expect(result.repeatedItemCompositeYoloCalls).toBe(0);
    expect(result.repeatedItemCompositeVlmCalls).toBe(0);
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
        return { model: 'rf-detr-medium', target: '#news-tab-v2', confidence: 0.84 };
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

  it('handles captcha escalation with yolo -> vlm -> llm retries before continuing', async () => {
    let solveAttempt = 0;
    let verifyAttempt = 0;

    const result = await runAssistantlessChatE2E({
      goal: 'captcha escalation flow',
      llmWarmupSteps: 1,
      maxSteps: 3,
      captchaMaxRetries: 3,
      captureScreenshot: async ({ step, stage }) => `runs/captcha-${step}-${stage}.png`,
      shareWithUser: async () => undefined,
      analyzeWithLlm: async () => ({ kind: 'click', target: '#next' }),
      decideWithRules: async () => ({ kind: 'click', target: '#next' }),
      detectCaptchaWithYolo: async () => ({
        detected: true,
        confidence: 0.82,
        label: 'captcha'
      }),
      confirmCaptchaWithVlm: async () => ({
        confirmed: true,
        reason: 'captcha widget visible'
      }),
      solveCaptchaWithLlm: async () => {
        solveAttempt += 1;
        return {
          solved: true,
          action: { kind: 'click', target: '#captcha-checkbox' }
        };
      },
      executeCaptchaSolveAction: async () => true,
      verifyCaptchaCleared: async () => {
        verifyAttempt += 1;
        return verifyAttempt >= 2;
      },
      executeAction: async () => ({ status: 'pass', done: true }),
      askUserDecision: async () => 'go'
    });

    expect(result.status).toBe('pass');
    expect(result.captchaYoloCalls).toBe(1);
    expect(result.captchaVlmCalls).toBe(1);
    expect(result.captchaLlmSolveCalls).toBe(2);
    expect(result.captchaRetries).toBe(2);
    expect(result.captchaSolved).toBe(1);
    expect(result.captchaFailed).toBe(0);
    expect(solveAttempt).toBe(2);
  });

  it('blocks when captcha retries are exhausted and user chooses not_go', async () => {
    const result = await runAssistantlessChatE2E({
      goal: 'captcha unresolved flow',
      llmWarmupSteps: 1,
      maxSteps: 2,
      captchaMaxRetries: 2,
      captureScreenshot: async ({ step, stage }) => `runs/captcha-block-${step}-${stage}.png`,
      shareWithUser: async () => undefined,
      analyzeWithLlm: async () => ({ kind: 'click', target: '#next' }),
      decideWithRules: async () => ({ kind: 'click', target: '#next' }),
      detectCaptchaWithYolo: async () => ({
        detected: true,
        confidence: 0.91,
        label: 'captcha'
      }),
      confirmCaptchaWithVlm: async () => ({
        confirmed: true
      }),
      solveCaptchaWithLlm: async () => ({
        solved: false,
        reason: 'solver failed'
      }),
      executeAction: async () => ({ status: 'pass', done: true }),
      askUserDecision: async () => 'not_go'
    });

    expect(result.status).toBe('blocked');
    expect(result.decisions).toEqual(['not_go']);
    expect(result.captchaYoloCalls).toBe(1);
    expect(result.captchaVlmCalls).toBe(1);
    expect(result.captchaLlmSolveCalls).toBe(2);
    expect(result.captchaRetries).toBe(2);
    expect(result.captchaSolved).toBe(0);
    expect(result.captchaFailed).toBe(1);
  });

  it('runs repeated-item composite chain and falls back yolo -> vlm on same image', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'assistantless-repeat-'));

    try {
      const listA = resolve(root, 'list-a.png');
      const listB = resolve(root, 'list-b.png');
      const listC = resolve(root, 'list-c.png');
      await makeImage(listA, 0xff0000ff);
      await makeImage(listB, 0x00ff00ff);
      await makeImage(listC, 0x0000ffff);

      let yoloCompositePath = '';
      let vlmCompositePath = '';

      const result = await runAssistantlessChatE2E({
        goal: '반복 상품 리스트 합성 판단',
        llmWarmupSteps: 1,
        maxSteps: 1,
        captureScreenshot: async ({ step, stage }) => resolve(root, `shot-${step}-${stage}.png`),
        shareWithUser: async () => undefined,
        shouldRunRepeatedItemComposite: async () => true,
        collectRepeatedItemImages: async () => [
          { id: 'item-a', imagePath: listA },
          { id: 'item-b', imagePath: listB },
          { id: 'item-c', imagePath: listC }
        ],
        judgeRepeatedItemsWithYolo: async ({ compositeImagePath }) => {
          yoloCompositePath = compositeImagePath;
          return {
            detections: [{ bbox: [70, 10, 92, 26], confidence: 0.22, label: 'candidate' }]
          };
        },
        judgeRepeatedItemsWithVlm: async ({ compositeImagePath }) => {
          vlmCompositePath = compositeImagePath;
          return {
            accepted: true,
            reason: 'vlm confirms target item'
          };
        },
        analyzeWithLlm: async () => ({ kind: 'click', target: '#next' }),
        decideWithRules: async () => ({ kind: 'click', target: '#next' }),
        executeAction: async () => ({ status: 'pass', done: true }),
        askUserDecision: async () => 'go'
      });

      expect(result.status).toBe('pass');
      expect(result.repeatedItemCompositeBuilds).toBe(1);
      expect(result.repeatedItemCompositeYoloCalls).toBe(1);
      expect(result.repeatedItemCompositeVlmCalls).toBe(1);
      expect(result.repeatedItemCompositeVlmFallbacks).toBe(1);
      expect(yoloCompositePath).toBe(vlmCompositePath);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
