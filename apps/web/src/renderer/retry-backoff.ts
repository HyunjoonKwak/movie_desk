// Exponential backoff for asset loads that keep failing (a missing OPFS copy,
// a disconnected drive, an import still writing its file). The first miss
// retries quickly because the file may simply not be there yet; repeated
// misses back off up to a cap so a preview with a lost asset stops probing
// the source every second for as long as the project is open.
//
// `token` is whatever was tried — the asset record, in practice. A token that
// differs from the one that failed (a rebuilt proxy, a relinked source, any
// edit to the record) starts over immediately instead of waiting out the cap.
export class RetryBackoff {
  private readonly nextAt = new Map<string, number>();
  private readonly delays = new Map<string, number>();
  private readonly tokens = new Map<string, unknown>();

  constructor(
    private readonly initialMs = 1_000,
    private readonly maxMs = 30_000,
    // Monotonic by default: a wall-clock step backwards must not strand an id.
    private readonly now: () => number = () => performance.now(),
  ) {}

  shouldTry(id: string, token?: unknown): boolean {
    if (this.tokens.has(id) && this.tokens.get(id) !== token) {
      this.forget(id);
      return true;
    }
    return (this.nextAt.get(id) ?? 0) <= this.now();
  }

  // Records a miss and returns the delay before the next attempt.
  fail(id: string, token?: unknown): number {
    const previous = this.delays.get(id);
    const delay = previous === undefined ? this.initialMs : Math.min(this.maxMs, previous * 2);
    this.delays.set(id, delay);
    this.nextAt.set(id, this.now() + delay);
    this.tokens.set(id, token);
    return delay;
  }

  succeed(id: string): void {
    this.forget(id);
  }

  // Drops ids no longer referenced so a removed asset does not pin memory.
  retain(ids: ReadonlySet<string>): void {
    for (const id of this.nextAt.keys()) if (!ids.has(id)) this.forget(id);
  }

  clear(): void {
    this.nextAt.clear();
    this.delays.clear();
    this.tokens.clear();
  }

  private forget(id: string): void {
    this.nextAt.delete(id);
    this.delays.delete(id);
    this.tokens.delete(id);
  }
}
