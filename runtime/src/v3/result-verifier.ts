export type VerificationResult = 'ok' | 'wrong' | 'failed';

export interface ResultVerifierInput {
  expectedResult?: string;
  preUrl: string;
  postUrl: string;
  domExists?: (selector: string) => Promise<boolean>;
  preVisualHash?: string;
  postVisualHash?: string;
  expectedVisualHash?: string;
}

function parseHint(expectedResult: string | undefined): { kind: 'url' | 'dom' | 'visual'; value?: string } {
  if (!expectedResult) {
    return { kind: 'visual' };
  }

  const trimmed = expectedResult.trim();
  const urlPrefix = 'URL 변경:';
  const domPrefix = 'DOM 존재:';

  if (trimmed.startsWith(urlPrefix)) {
    return {
      kind: 'url',
      value: trimmed.slice(urlPrefix.length).trim()
    };
  }

  if (trimmed.startsWith(domPrefix)) {
    return {
      kind: 'dom',
      value: trimmed.slice(domPrefix.length).trim()
    };
  }

  return { kind: 'visual' };
}

function hashDistance(left: string, right: string): number {
  const maxLength = Math.max(left.length, right.length);
  if (maxLength === 0) {
    return 0;
  }
  let diff = 0;
  for (let index = 0; index < maxLength; index += 1) {
    if ((left[index] ?? '') !== (right[index] ?? '')) {
      diff += 1;
    }
  }
  return diff;
}

export class ResultVerifier {
  private readonly visualChangeThreshold = 1;
  private readonly expectedVisualThreshold = 12;

  async verify(input: ResultVerifierInput): Promise<VerificationResult> {
    const hint = parseHint(input.expectedResult);
    const urlChanged = input.postUrl !== input.preUrl;

    if (hint.kind === 'url' && hint.value) {
      if (input.postUrl.includes(hint.value)) {
        return 'ok';
      }
      if (urlChanged) {
        return 'wrong';
      }
      return 'failed';
    }

    if (hint.kind === 'dom' && hint.value) {
      if (!input.domExists) {
        return urlChanged ? 'wrong' : 'failed';
      }
      const exists = await input.domExists(hint.value);
      if (exists) {
        return 'ok';
      }
      return urlChanged ? 'wrong' : 'failed';
    }

    if (urlChanged) {
      return 'ok';
    }

    if (!input.preVisualHash || !input.postVisualHash) {
      return 'failed';
    }

    const changedDistance = hashDistance(input.preVisualHash, input.postVisualHash);
    if (changedDistance <= this.visualChangeThreshold) {
      return 'failed';
    }

    if (input.expectedVisualHash) {
      const distanceToExpected = hashDistance(input.postVisualHash, input.expectedVisualHash);
      if (distanceToExpected > this.expectedVisualThreshold) {
        return 'wrong';
      }
    }

    return 'ok';
  }
}
