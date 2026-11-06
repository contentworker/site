/**
 * The ContentWorker webhook receiver: verifies the signature and turns an event into the cache
 * tags to purge. Register it in ContentWorker (space settings → webhooks) with the URL
 * https://<site>/__cw/webhook, the topics below (or "*") and a secret, and set the same secret as
 * CONTENTWORKER_WEBHOOK_SECRET.
 */
import { verifyWebhookSignature } from '@contentworker/sdk/webhooks';

export const TOPICS = [
  'entry.published',
  'entry.unpublished',
  'entries.published_bulk',
  'asset.published',
  'asset.unpublished',
  'asset.deleted',
  'asset.rights_changed',
  'content_type.published',
  'menus.changed',
  'release.published',
  'environment_alias.changed',
  'environment.deleted',
  'redirects.changed',
];

export interface SignedDelivery {
  secret: string | undefined;
  body: string;
  signature: string | null;
  timestamp: string | null;
  now?: number;
}

/**
 * The signature check is `@contentworker/sdk/webhooks` (HMAC-SHA256 of `<timestamp>.<body>`,
 * constant time, a 5-minute freshness window): the same check any frontend uses.
 */
export async function verifySignature({
  secret,
  now,
  ...delivery
}: SignedDelivery): Promise<boolean> {
  if (!secret) return false;
  return verifyWebhookSignature({ ...delivery, secret, ...(now === undefined ? {} : { now }) });
}

/** A ContentWorker event, as far as purging cares. */
export interface CwEvent {
  id?: string;
  type: string;
  entryId?: string;
  assetId?: string;
  contentTypeApiId?: string;
  [key: string]: unknown;
}

const typeTag = (event: CwEvent): string[] =>
  typeof event.contentTypeApiId === 'string' && event.contentTypeApiId
    ? [`type:${event.contentTypeApiId}`]
    : [];

/**
 * The tags an event invalidates. Entries and assets purge everything that rendered them
 * (`e:<id>`); a publish also purges cached 404s, because the path may exist now (or be a
 * redirect). Changes that
 * reshape content (types, releases, aliases, bulk publishes) purge the whole site.
 * @param {{ type: string, scope?: { environmentId?: string }, [k: string]: any }} event
 * @returns {string[]}
 */
export function tagsForEvent(event: CwEvent | null | undefined): string[] {
  switch (event?.type) {
    // type:<contentType> purges lists that include the entry: sitemaps, llms.txt, redirects.
    // `menu` too: a menu's links resolve at read time, so a publish can add, rename or move an
    // item, and a dropped item leaves no tag of its own. Only pages showing a menu carry it.
    case 'entry.published':
      return [`e:${event.entryId}`, 'notfound', 'menu', ...typeTag(event)];
    case 'entry.unpublished':
      return [`e:${event.entryId}`, 'menu', ...typeTag(event)];
    case 'asset.published':
    case 'asset.unpublished':
    case 'asset.deleted':
    case 'asset.rights_changed':
      return [`e:${event.assetId}`];
    // Redirects changed in the CMS: cached redirects and 404s (a path may now redirect).
    case 'redirects.changed':
      return ['redirects', 'notfound'];
    case 'menus.changed':
      return ['menu'];
    case 'entries.published_bulk':
    case 'content_type.published':
    case 'release.published':
    case 'environment_alias.changed':
    case 'environment.deleted':
      return ['site'];
    default:
      return [];
  }
}

/**
 * @param {Request} request
 * @param {{ secret?: string, enqueue: (tags: string[]) => Promise<void> }} deps
 */
export async function handleWebhook(
  request: Request,
  {
    secret,
    enqueue,
  }: { secret: string | undefined; enqueue: (tags: string[]) => Promise<unknown> },
): Promise<Response> {
  if (!secret) return new Response('Webhook not configured', { status: 404 });
  const body = await request.text();
  const ok = await verifySignature({
    secret,
    body,
    signature: request.headers.get('x-contentworker-signature'),
    timestamp: request.headers.get('x-contentworker-timestamp'),
  });
  if (!ok) return new Response('Invalid signature', { status: 401 });
  let event: CwEvent;
  try {
    event = JSON.parse(body) as CwEvent;
  } catch {
    return new Response('Bad payload', { status: 400 });
  }
  const tags = tagsForEvent(event);
  // Purging is idempotent, so ContentWorker's retries need no dedupe.
  if (tags.length) await enqueue(tags);
  return Response.json({ ok: true, tags });
}
