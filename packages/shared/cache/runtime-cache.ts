import { LRUCache } from "lru-cache";

export type RuntimeCacheOptions = {
  max: number;
  ttlMs?: number;
};

export class RuntimeCache<TKey extends {}, TValue extends {}> {
  private readonly cache: LRUCache<TKey, TValue>;

  constructor(options: RuntimeCacheOptions) {
    this.cache = new LRUCache<TKey, TValue>({
      max: options.max,
      ttl: options.ttlMs,
    });
  }

  get(key: TKey): TValue | undefined {
    return this.cache.get(key);
  }

  set(key: TKey, value: TValue): void {
    this.cache.set(key, value);
  }

  has(key: TKey): boolean {
    return this.cache.has(key);
  }

  delete(key: TKey): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  values(): IterableIterator<TValue> {
    return this.cache.values();
  }

  async getOrSet(key: TKey, loader: () => Promise<TValue>): Promise<TValue> {
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const value = await loader();
    this.cache.set(key, value);
    return value;
  }
}
