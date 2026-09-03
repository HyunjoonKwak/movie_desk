// Exponential backoff for asset loads that keep failing (a missing OPFS copy,
// a disconnected drive, an import still writing its file). The first miss
// retries quickly because the file may simply not be there yet; repeated
// misses back off up to a cap so a preview with a lost asset stops probing
// the source every second for as long as the project is open.
export class RetryBackoff {
  private readonly nextAt = new Map<string, number>();
  private readonly delays = new Map<string, number>();

  constructor(
    private readonly initialMs = 1_000,
    private readonly maxMs = 30_000,
  ) {}

  shouldTry(id: string, now = Date.now()): boolean {
    return (this.nextAt.get(id) ?? 0) <= now;
  }

  // Records a miss and returns the delay before the next attempt.
  fail(id: string, now = Date.now()): number {
    const previous = this.delays.get(id);
    const delay = previous === undefined ? this.initialMs : Math.min(this.maxMs, previous * 2);
    this.delays.set(id, delay);
    this.nextAt.set(id, now + delay);
    return delay;
  }

  succeed(id: string): void {
    this.nextAt.delete(id);
    this.delays.delete(id);
  }

  // Drops ids no longer referenced so a removed asset does not pin memory.
  retain(ids: ReadonlySet<string>): void {
    for (const id of this.nextAt.keys()) if (!ids.has(id)) this.succeed(id);
  }

  clear(): void {
    this.nextAt.clear();
    this.delays.clear();
  }
}
