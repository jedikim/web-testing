export type ViewMode = 'screenshot';

export interface ViewModeInput {
  forceCheckpoint?: boolean;
}

export function pickViewMode(input: ViewModeInput = {}): ViewMode {
  void input;
  return 'screenshot';
}
