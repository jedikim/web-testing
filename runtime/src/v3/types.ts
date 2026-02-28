export interface DOMNode {
  nodeId: number;
  backendNodeId?: number;
  tag: string;
  text: string;
  attrs: Record<string, string>;
  axRole?: string;
  axName?: string;
}

export type MatchType = 'exact' | 'phrase' | 'word' | 'synonym' | 'fuzzy' | 'none';

export interface MatchResult {
  type: MatchType;
  score: number;
}

export interface ScoredNodeMatch {
  keyword: string;
  attribute: string;
  matchType: MatchType;
  rawScore: number;
  weightedScore: number;
}

export interface ScoredNode {
  node: DOMNode;
  score: number;
  matches: ScoredNodeMatch[];
}

export type StepActionType = 'click' | 'type' | 'wait' | 'navigate' | 'summarize';

export interface StepPlan {
  stepIndex: number;
  actionType: StepActionType;
  targetDescription: string;
  value?: string;
  keywordWeights: Record<string, number>;
  targetViewportXY?: [number, number];
  expectedResult?: string;
}

export interface ScreenState {
  hasObstacle: boolean;
  obstacleType?: 'popup' | 'ad_banner' | 'cookie_consent' | 'event_splash' | string;
  obstacleCloseXY?: [number, number];
  obstacleDescription?: string;
}

export interface Action {
  selector: string | null;
  actionType: StepActionType;
  value?: string;
  viewportXY?: [number, number];
  viewportBbox?: [number, number, number, number];
}

export interface CacheEntry {
  domain: string;
  urlPattern: string;
  taskType: string;
  selector: string | null;
  actionType: StepActionType;
  value?: string;
  keywordWeights: Record<string, number>;
  viewportXY?: [number, number];
  viewportBbox?: [number, number, number, number];
  expectedResult?: string;
  postScreenshotPath?: string;
  postScreenshotPhash?: string;
  successCount: number;
  lastSuccess?: string;
}

export interface Skill {
  name: string;
  domain: string;
  taskPattern: string;
  code: string;
  plan: StepPlan[];
  successCount: number;
  lastSuccess?: string;
  createdAt: string;
}
