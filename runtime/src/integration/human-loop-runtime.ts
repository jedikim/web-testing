export type HumanDecision = 'go' | 'not_go' | 'revise' | 'unknown';

export interface HumanLoopRunResult {
  status: 'pass' | 'fail' | 'need_user';
  reason?: string;
  screenshotPath?: string;
  question?: string;
}

export interface DecisionRequest {
  workflowId: string;
  screenshotPath?: string;
  question?: string;
}

export interface DecisionPort {
  requestDecision(input: DecisionRequest): Promise<HumanDecision>;
}

export interface RunHumanLoopInput {
  workflowId: string;
  run: () => Promise<HumanLoopRunResult>;
  decisionPort: DecisionPort;
  reviseWithLlm?: () => Promise<void>;
  maxTurns?: number;
}

export interface RunHumanLoopOutput {
  status: 'pass' | 'fail' | 'blocked';
  turns: number;
  revisions: number;
  decisions: HumanDecision[];
}

export async function runHumanLoop(input: RunHumanLoopInput): Promise<RunHumanLoopOutput> {
  const maxTurns = input.maxTurns ?? 8;
  let turns = 0;
  let revisions = 0;
  const decisions: HumanDecision[] = [];

  while (turns < maxTurns) {
    turns += 1;
    const result = await input.run();

    if (result.status === 'pass') {
      return { status: 'pass', turns, revisions, decisions };
    }
    if (result.status === 'fail') {
      return { status: 'fail', turns, revisions, decisions };
    }

    const decision = await input.decisionPort.requestDecision({
      workflowId: input.workflowId,
      screenshotPath: result.screenshotPath,
      question: result.question
    });
    decisions.push(decision);

    if (decision === 'not_go' || decision === 'unknown') {
      return { status: 'blocked', turns, revisions, decisions };
    }

    if (decision === 'revise') {
      if (input.reviseWithLlm) {
        await input.reviseWithLlm();
      }
      revisions += 1;
      continue;
    }
  }

  return { status: 'blocked', turns, revisions, decisions };
}
