import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import Jimp from 'jimp';

import { runAssistantlessChatE2E } from '../src/testing/assistantless-chat-e2e';

async function makeImage(path: string, color: number): Promise<void> {
  const image = await new Jimp(64, 64, color);
  await image.writeAsync(path);
}

async function main(): Promise<void> {
  const root = await mkdtemp(resolve(tmpdir(), 'repeated-item-example-'));

  try {
    const listA = resolve(root, 'item-a.png');
    const listB = resolve(root, 'item-b.png');
    const listC = resolve(root, 'item-c.png');
    await makeImage(listA, 0xff0000ff);
    await makeImage(listB, 0x00ff00ff);
    await makeImage(listC, 0x0000ffff);

    const result = await runAssistantlessChatE2E({
      goal: 'Repeated listing judgement demo',
      maxSteps: 1,
      llmWarmupSteps: 1,
      repeatedItemCompositeRootDir: root,
      captureScreenshot: async ({ step, stage }) => resolve(root, `shot-${step}-${stage}.png`),
      shareWithUser: async () => undefined,
      shouldRunRepeatedItemComposite: async () => true,
      collectRepeatedItemImages: async () => [
        { id: 'item-a', imagePath: listA },
        { id: 'item-b', imagePath: listB },
        { id: 'item-c', imagePath: listC }
      ],
      judgeRepeatedItemsWithYolo: async () => ({
        detections: [{ bbox: [70, 10, 90, 30], confidence: 0.24, label: 'candidate' }]
      }),
      judgeRepeatedItemsWithVlm: async () => ({
        accepted: true,
        reason: 'VLM confirms repeated item target set'
      }),
      analyzeWithLlm: async () => ({ kind: 'click', target: '#next' }),
      decideWithRules: async () => ({ kind: 'click', target: '#next' }),
      executeAction: async () => ({ status: 'pass', done: true }),
      askUserDecision: async () => 'go'
    });

    console.log({
      status: result.status,
      compositeBuilds: result.repeatedItemCompositeBuilds,
      yoloCalls: result.repeatedItemCompositeYoloCalls,
      vlmCalls: result.repeatedItemCompositeVlmCalls,
      vlmFallbacks: result.repeatedItemCompositeVlmFallbacks
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
