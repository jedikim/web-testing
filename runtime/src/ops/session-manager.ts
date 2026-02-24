export class SessionManager {
  private readonly active = new Set<string>();
  private readonly maxConcurrent: number;

  constructor(maxConcurrent: number) {
    this.maxConcurrent = Math.max(1, maxConcurrent);
  }

  startSession(sessionId: string): boolean {
    if (this.active.has(sessionId)) {
      return true;
    }
    if (this.active.size >= this.maxConcurrent) {
      return false;
    }
    this.active.add(sessionId);
    return true;
  }

  endSession(sessionId: string): void {
    this.active.delete(sessionId);
  }

  getActiveSessions(): string[] {
    return [...this.active];
  }
}
