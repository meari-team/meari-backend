// 같은 키(일기 ID)의 작업을 순서대로 하나씩 실행한다. 다른 키는 동시에 돈다.
// NestJS 인스턴스가 하나일 때만 유효하다 (ADR-005).
export class KeyedLock {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(task);
    const tail = next.catch(() => undefined);
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return next;
  }

  get size() {
    return this.tails.size;
  }
}
