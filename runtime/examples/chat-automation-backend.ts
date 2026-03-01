import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startChatAutomationServer } from '../src/index';
import { loadEnvFiles } from '../src/config/load-env-file';

async function main(): Promise<void> {
  const currentFile = fileURLToPath(import.meta.url);
  const examplesDir = dirname(currentFile);
  const runtimeRoot = resolve(examplesDir, '..');
  const repoRoot = resolve(runtimeRoot, '..');

  loadEnvFiles({
    cwd: repoRoot,
    filenames: ['runtime/.env', '.env']
  });

  const uiDir = resolve(runtimeRoot, 'examples', 'chat-automation-ui');
  const executionMode = process.env.CHAT_AUTOMATION_EXECUTION_MODE === 'simulate'
    ? 'simulate'
    : 'playwright';
  const runtimeScreenshotRoot =
    process.env.CHAT_AUTOMATION_RUNTIME_SCREENSHOT_ROOT ??
    resolve(repoRoot, 'testing', 'chat-automation', 'runtime-shots');

  await startChatAutomationServer({
    uiDir,
    executionMode,
    runtimeScreenshotRoot
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
