export interface RollbackEntry {
  changeId: string;
  reason: string;
  timestamp: string;
}

export class RollbackLog {
  private readonly entries: RollbackEntry[] = [];

  add(entry: RollbackEntry): void {
    this.entries.push(entry);
  }

  latest(): RollbackEntry | undefined {
    return this.entries[this.entries.length - 1];
  }

  byChangeId(changeId: string): RollbackEntry[] {
    return this.entries.filter((entry) => entry.changeId === changeId);
  }
}
