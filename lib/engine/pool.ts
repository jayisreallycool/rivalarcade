/**
 * Tiny object pool. Games recycle obstacles/targets instead of allocating meshes
 * every spawn, which removes GC hitches and GPU buffer churn during play.
 */
export class Pool<T> {
  private readonly free: T[] = [];
  readonly active = new Set<T>();

  constructor(
    private readonly create: () => T,
    private readonly onAcquire?: (item: T) => void,
    private readonly onRelease?: (item: T) => void,
  ) {}

  acquire(): T {
    const item = this.free.pop() ?? this.create();
    this.active.add(item);
    this.onAcquire?.(item);
    return item;
  }

  release(item: T) {
    if (!this.active.delete(item)) return;
    this.onRelease?.(item);
    this.free.push(item);
  }

  releaseAll() {
    for (const item of Array.from(this.active)) this.release(item);
  }

  /** Pre-allocate so the first seconds of play don't allocate. */
  warm(count: number) {
    const items: T[] = [];
    for (let i = 0; i < count; i++) items.push(this.acquire());
    items.forEach((i) => this.release(i));
  }
}
