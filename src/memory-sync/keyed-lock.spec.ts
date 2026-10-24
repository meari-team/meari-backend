import { KeyedLock } from './keyed-lock.js';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

describe('KeyedLock', () => {
  it('같은 키는 앞 작업이 끝난 뒤에 시작한다', async () => {
    const lock = new KeyedLock();
    const gate = deferred();
    const order: string[] = [];

    const a = lock.run('e1', async () => {
      order.push('a:start');
      await gate.promise;
      order.push('a:end');
    });
    const b = lock.run('e1', () => {
      order.push('b');
      return Promise.resolve();
    });

    await new Promise((r) => setTimeout(r, 0));
    expect(order).toEqual(['a:start']); // b는 a가 끝나길 기다린다
    gate.resolve();
    await Promise.all([a, b]);
    expect(order).toEqual(['a:start', 'a:end', 'b']);
  });

  it('다른 키는 기다리지 않는다', async () => {
    const lock = new KeyedLock();
    const gate = deferred();
    const blocked = lock.run('e1', () => gate.promise);
    await expect(lock.run('e2', () => Promise.resolve('done'))).resolves.toBe(
      'done',
    );
    gate.resolve();
    await blocked;
  });

  it('앞 작업이 실패해도 다음 작업은 실행되고, 실패는 그 호출자에게만 간다', async () => {
    const lock = new KeyedLock();
    const failed = lock.run('e1', () => Promise.reject(new Error('boom')));
    const ok = lock.run('e1', () => Promise.resolve(1));
    await expect(failed).rejects.toThrow('boom');
    await expect(ok).resolves.toBe(1);
  });

  it('작업이 끝나면 키를 정리한다', async () => {
    const lock = new KeyedLock();
    await lock.run('e1', () => Promise.resolve());
    await new Promise((r) => setTimeout(r, 0));
    expect(lock.size).toBe(0);
  });
});
