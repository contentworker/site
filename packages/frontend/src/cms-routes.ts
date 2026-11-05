import type { Delivery } from './delivery.ts';
import { routesFromPatterns, setCmsRoutes } from './routes.ts';

/**
 * Routes from the CMS: each content type's URL pattern (Delivery's /routes), so editors decide
 * URLs and sites don't hard-code them. Loaded on a cache miss (hits never run the Worker), kept per
 * isolate for TTL_MS, one request in flight at a time. A ContentWorker without /routes, or one that
 * fails, leaves the table as it was and is asked again after RETRY_MS.
 */
export const TTL_MS = 60_000;
export const RETRY_MS = 300_000;

let freshUntil = 0;
let inflight: Promise<void> | null = null;

export async function ensureCmsRoutes(delivery: Pick<Delivery, 'routes'>): Promise<void> {
  if (Date.now() < freshUntil) return;
  inflight ??= (async () => {
    try {
      const items = await delivery.routes();
      if (items) {
        setCmsRoutes(routesFromPatterns(items));
        freshUntil = Date.now() + TTL_MS;
      } else {
        freshUntil = Date.now() + RETRY_MS;
      }
    } catch (error) {
      console.error(JSON.stringify({ msg: 'cms routes unavailable', error: String(error) }));
      freshUntil = Date.now() + RETRY_MS;
    } finally {
      inflight = null;
    }
  })();
  await inflight;
}

/** For tests: forget what was loaded. */
export function resetCmsRoutes(): void {
  freshUntil = 0;
  inflight = null;
  setCmsRoutes([]);
}
