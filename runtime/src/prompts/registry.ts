import { CHAT_ACTION_PLANNER_PROMPT_V1 } from './chat-action-planner';
import { CHAT_RESULT_VALIDATOR_PROMPT_V1 } from './chat-result-validator';
import { CHAT_SUMMARY_FORMATTER_PROMPT_V1 } from './chat-summary-formatter';
import { CHAT_TASK_ANALYZER_PROMPT_V1 } from './chat-task-analyzer';
import { EVOLUTION_AUTOFIX_PROMPT_V1 } from './evolution-autofix';
import { GEMINI_TURN_GUIDANCE_PROMPT_V1 } from './gemini-turn-guidance';

export const PROMPT_REGISTRY = {
  [CHAT_ACTION_PLANNER_PROMPT_V1.id]: CHAT_ACTION_PLANNER_PROMPT_V1.version,
  [CHAT_RESULT_VALIDATOR_PROMPT_V1.id]: CHAT_RESULT_VALIDATOR_PROMPT_V1.version,
  [CHAT_SUMMARY_FORMATTER_PROMPT_V1.id]: CHAT_SUMMARY_FORMATTER_PROMPT_V1.version,
  [CHAT_TASK_ANALYZER_PROMPT_V1.id]: CHAT_TASK_ANALYZER_PROMPT_V1.version,
  [GEMINI_TURN_GUIDANCE_PROMPT_V1.id]: GEMINI_TURN_GUIDANCE_PROMPT_V1.version,
  [EVOLUTION_AUTOFIX_PROMPT_V1.id]: EVOLUTION_AUTOFIX_PROMPT_V1.version
} as const;

export function listPromptVersions(): Array<{ id: string; version: string }> {
  return Object.entries(PROMPT_REGISTRY).map(([id, version]) => ({ id, version }));
}
