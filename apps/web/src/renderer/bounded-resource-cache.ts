// Small deterministic LRU for resources that need explicit destruction
// (WebGL textures, media elements, decoder handles). Reading an entry marks it
// as recently used; insertion enforces the configured hard cap.
export class BoundedResourceCache<K, V> {
  private readonly entries = new Map<K, { value: V; usedAt: number; weight: number }>();
  private clock = 0;
  private totalWeight = 0;
  private readonly pins = new Map<K, number>();
  private readonly retired = new Set<K>();

  constructor(
    private readonly maxEntries: number,
    private readonly disposeValue: (value: V, key: K) => void,
    private readonly maxWeight = Number.POSITIVE_INFINITY,
    private readonly weigh: (value: V) => number = () => 0,
  ) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new Error("BoundedResourceCache maxEntries must be a positive integer");
    }
  }

  get weight(): number {
    return this.totalWeight;
  }

  // Reserve before allocating GPU storage, so eviction also bounds peak residency.
  reserve(weight: number): void {
    if (!Number.isFinite(weight) || weight < 0 || weight > this.maxWeight)
      throw new Error("Resource exceeds cache weight budget");
    if (!this.tryReserve(weight, 0)) throw new Error("Resource exceeds available cache budget");
  }

  get size(): number {
    return this.entries.size;
  }

  // A lease survives awaits and retain/delete calls. Destruction is deferred
  // until the last borrower releases; leased bytes still count against the cap.
  pin(key: K): (() => void) | undefined {
    if (!this.entries.has(key) || this.retired.has(key)) return undefined;
    this.pins.set(key, (this.pins.get(key) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const count = (this.pins.get(key) ?? 1) - 1;
      if (count) this.pins.set(key, count);
      else {
        this.pins.delete(key);
        if (this.retired.delete(key)) this.delete(key);
      }
    };
  }

  // Check the whole reservation before evicting anything. A caller can return
  // a black frame on exhaustion without deleting a parent's live working set.
  tryReserve(weight: number, entries = 1): boolean {
    if (!Number.isFinite(weight) || weight < 0 || weight > this.maxWeight) return false;
    let pinnedWeight = 0;
    let pinnedCount = 0;
    for (const [key, entry] of this.entries) {
      if (this.pins.has(key)) {
        pinnedWeight += entry.weight;
        pinnedCount++;
      }
    }
    if (pinnedWeight + weight > this.maxWeight || pinnedCount + entries > this.maxEntries)
      return false;
    this.pruneToLimit(weight, entries);
    return true;
  }

  get(key: K): V | undefined {
    if (this.retired.has(key)) return undefined;
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    entry.usedAt = ++this.clock;
    return entry.value;
  }

  set(key: K, value: V): void {
    const weight = this.weigh(value);
    if (!Number.isFinite(weight) || weight < 0 || weight > this.maxWeight)
      throw new Error("Resource exceeds cache weight budget");
    const previous = this.entries.get(key);
    if (previous && previous.value !== value && this.pins.has(key))
      throw new Error("Cannot replace a leased resource");
    if (previous && previous.value !== value) this.disposeValue(previous.value, key);
    this.totalWeight += weight - (previous?.weight ?? 0);
    this.entries.set(key, { value, usedAt: ++this.clock, weight });
    this.pruneToLimit();
  }

  delete(key: K): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    if (this.pins.has(key)) {
      this.retired.add(key);
      return true;
    }
    this.entries.delete(key);
    this.totalWeight -= entry.weight;
    this.disposeValue(entry.value, key);
    return true;
  }

  retain(keys: ReadonlySet<K>): void {
    for (const key of this.entries.keys()) {
      if (!keys.has(key)) this.delete(key);
    }
  }

  clear(): void {
    for (const key of this.entries.keys()) this.delete(key);
  }

  private pruneToLimit(reserved = 0, reservedEntries = 0): void {
    while (this.entries.size + reservedEntries > this.maxEntries || this.totalWeight + reserved > this.maxWeight) {
      let oldestKey: K | undefined;
      let found = false;
      let oldestUse = Number.POSITIVE_INFINITY;
      for (const [key, entry] of this.entries) {
        if (this.pins.has(key)) continue;
        if (entry.usedAt < oldestUse) {
          oldestKey = key;
          found = true;
          oldestUse = entry.usedAt;
        }
      }
      if (!found) return;
      this.delete(oldestKey as K);
    }
  }
}
