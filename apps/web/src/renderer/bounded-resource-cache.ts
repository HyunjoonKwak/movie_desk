// Small deterministic LRU for resources that need explicit destruction
// (WebGL textures, media elements, decoder handles). Reading an entry marks it
// as recently used; insertion enforces the configured hard cap.
export class BoundedResourceCache<K, V> {
  private readonly entries = new Map<K, { value: V; usedAt: number; weight: number }>();
  private clock = 0;
  private totalWeight = 0;

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
    this.pruneToLimit(weight);
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: K): V | undefined {
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
    if (previous && previous.value !== value) this.disposeValue(previous.value, key);
    this.totalWeight += weight - (previous?.weight ?? 0);
    this.entries.set(key, { value, usedAt: ++this.clock, weight });
    this.pruneToLimit();
  }

  delete(key: K): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
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
    for (const [key, entry] of this.entries) this.disposeValue(entry.value, key);
    this.entries.clear();
    this.totalWeight = 0;
  }

  private pruneToLimit(reserved = 0): void {
    while (this.entries.size > this.maxEntries || this.totalWeight + reserved > this.maxWeight) {
      let oldestKey: K | undefined;
      let found = false;
      let oldestUse = Number.POSITIVE_INFINITY;
      for (const [key, entry] of this.entries) {
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
