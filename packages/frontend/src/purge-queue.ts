import { DurableObject } from 'cloudflare:workers';

/**
 * Batches cache purges and repeats each one once. ContentWorker's Delivery API caches for up to
 * 60 s, so a page re-rendered right after a publish can still read the old JSON. Every tag is
 * purged twice: within a second of the webhook, and again after LATER_MS. One instance
 * (idFromName("purge")) coalesces bursts into a few purge calls, which also stays inside Workers
 * Caching's purge rate limit.
 */
export const SOON_MS = 500;
export const LATER_MS = 65_000;
/** Tags per purge call. */
const CHUNK = 100;

export class PurgeQueue extends DurableObject {
  async add(tags: string[]): Promise<void> {
    const s = this.ctx.storage;
    const now = new Set((await s.get<string[]>('now')) ?? []);
    const later = new Set((await s.get<string[]>('later')) ?? []);
    for (const t of tags) {
      now.add(t);
      later.add(t);
    }
    const t = Date.now();
    await s.put({ now: [...now], later: [...later], laterAt: t + LATER_MS });
    const alarm = await s.getAlarm();
    if (alarm == null || alarm > t + SOON_MS) await s.setAlarm(t + SOON_MS);
  }

  override async alarm(): Promise<void> {
    const s = this.ctx.storage;
    const now = (await s.get<string[]>('now')) ?? [];
    if (now.length) {
      await this.purge(now); // a throw retries the alarm, so a failed purge is not lost
      await s.delete('now');
    }
    const laterAt = await s.get<number>('laterAt');
    if (laterAt == null) return;
    if (Date.now() >= laterAt) {
      const later = (await s.get<string[]>('later')) ?? [];
      if (later.length) await this.purge(later);
      await s.delete(['later', 'laterAt']);
    } else {
      await s.setAlarm(laterAt);
    }
  }

  /** Purges run in the cached `Site` entrypoint: a purge only reaches its caller's own cache. */
  async purge(tags: string[]): Promise<void> {
    const site = this.ctx.exports.Site;
    // `site` is on every page, so it clears all HTML while the immutable code files stay cached.
    const list = tags.includes('site') ? ['site'] : tags;
    for (let i = 0; i < list.length; i += CHUNK)
      await site.purge({ tags: list.slice(i, i + CHUNK) });
  }
}
