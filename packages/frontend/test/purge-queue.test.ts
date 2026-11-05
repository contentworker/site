import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LATER_MS, PurgeQueue } from '../src/purge-queue.ts';

/** In-memory DurableObjectState: storage + one alarm + ctx.exports.Site. */
function state() {
  const data = new Map<string, unknown>();
  let alarm: number | null = null;
  const purges: CachePurgeOptions[] = [];
  const storage = {
    get: async (k: string) => data.get(k),
    put: async (obj: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(obj)) data.set(k, v);
    },
    delete: async (k: string | string[]) => {
      for (const x of ([] as string[]).concat(k)) data.delete(x);
    },
    getAlarm: async () => alarm,
    setAlarm: async (t: number) => {
      alarm = t;
    },
  };
  const exports = {
    Site: { purge: async (o: CachePurgeOptions): Promise<unknown> => purges.push(o) },
  };
  return { storage, exports, purges, alarmAt: () => alarm, data };
}

/** The fake as the DurableObjectState the class expects. */
const asState = (s: ReturnType<typeof state>) => s as unknown as DurableObjectState;

test('purges once soon and once again after the Delivery cache window, coalescing bursts', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const ctx = state();
  const q = new PurgeQueue(asState(ctx), {} as never);
  await q.add(['e:a']);
  await q.add(['e:b', 'e:a']);
  assert.equal(ctx.alarmAt(), 1_000_000 + 500);

  await q.alarm(); // the soon purge
  assert.deepEqual(ctx.purges, [{ tags: ['e:a', 'e:b'] }]);
  assert.equal(ctx.alarmAt(), 1_000_000 + LATER_MS);

  t.mock.timers.setTime(1_000_000 + LATER_MS);
  await q.alarm(); // the repeat
  assert.deepEqual(ctx.purges[1], { tags: ['e:a', 'e:b'] });
  assert.equal(ctx.data.size, 0);
});

test('a site-wide change purges just the site tag', async () => {
  const ctx = state();
  const q = new PurgeQueue(asState(ctx), {} as never);
  await q.add(['e:a', 'site']);
  await q.alarm();
  assert.deepEqual(ctx.purges, [{ tags: ['site'] }]);
});

test('a failed purge throws, so the alarm retries and keeps the tags', async () => {
  const ctx = state();
  ctx.exports.Site.purge = async () => {
    throw new Error('rate limited');
  };
  const q = new PurgeQueue(asState(ctx), {} as never);
  await q.add(['e:a']);
  await assert.rejects(q.alarm(), /rate limited/);
  assert.deepEqual(ctx.data.get('now'), ['e:a']);
});
