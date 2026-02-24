export type ViewMode = 'screencast' | 'screenshot';

export interface ViewModeInput {
  screencastAvailable: boolean;
  screencastHealthy: boolean;
}

export function pickViewMode(input: ViewModeInput): ViewMode {
  if (input.screencastAvailable && input.screencastHealthy) {
    return 'screencast';
  }
  return 'screenshot';
}
