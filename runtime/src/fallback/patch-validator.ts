export type SelectorPatchOp = 'add' | 'replace' | 'remove';

export interface SelectorPatchOperation {
  op: SelectorPatchOp;
  path: string;
  value?: {
    css?: string;
    fingerprint?: {
      text?: string;
      role?: string;
      idHint?: string;
      classTokens?: string[];
      nearbyText?: string[];
      bboxNorm?: [number, number, number, number];
    };
  };
}

export interface SelectorPatch {
  target: 'selectors';
  reason: string;
  operations: SelectorPatchOperation[];
}

export type SelectorPatchErrorCode =
  | 'INVALID_TARGET'
  | 'EMPTY_OPERATIONS'
  | 'INVALID_PATH'
  | 'INVALID_VALUE';

export interface SelectorPatchError {
  code: SelectorPatchErrorCode;
  message: string;
}

export interface SelectorPatchValidation {
  valid: boolean;
  errors: SelectorPatchError[];
}

function isSelectorPath(path: string): boolean {
  return path.startsWith('/selectors/') && path.length > '/selectors/'.length;
}

export function validateSelectorPatch(patch: SelectorPatch): SelectorPatchValidation {
  const errors: SelectorPatchError[] = [];

  if (patch.target !== 'selectors') {
    errors.push({ code: 'INVALID_TARGET', message: 'patch target must be selectors' });
  }

  if (!patch.operations || patch.operations.length === 0) {
    errors.push({ code: 'EMPTY_OPERATIONS', message: 'operations must not be empty' });
    return { valid: false, errors };
  }

  for (const op of patch.operations) {
    if (!isSelectorPath(op.path)) {
      errors.push({
        code: 'INVALID_PATH',
        message: `operation path must start with /selectors/: ${op.path}`
      });
      continue;
    }

    if ((op.op === 'add' || op.op === 'replace') && !op.value?.css?.trim()) {
      errors.push({
        code: 'INVALID_VALUE',
        message: `${op.op} operation requires a non-empty css value`
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
