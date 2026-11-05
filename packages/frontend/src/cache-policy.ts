/**
 * Edge cache policy for the cached `Site` entrypoint (Workers Caching). The cache sits in front
 * of the entrypoint: a hit is served from Cloudflare's tiered cache without running the Worker.
 * Freshness comes from purges by tag (src/purge-queue.js), not from short TTLs.
 */

/** Browsers revalidate HTML every time (cheap 304s, still bfcache-eligible: no `no-store`). */
export const BROWSER_HTML = 'public, max-age=0, must-revalidate';
/** The edge keeps pages a day; purges make them fresh, SWR hides the refresh, stale-if-error rides out a CMS outage. */
export const EDGE_PAGE =
  'public, max-age=86400, stale-while-revalidate=86400, stale-if-error=604800';
/** Not-found pages: short, and purged on every publish (tag `notfound`) in case the path now exists. */
export const EDGE_NOT_FOUND = 'public, max-age=300';
export const IMMUTABLE = 'public, max-age=31536000, immutable';
export const NO_STORE = 'private, no-store';

/** Cloudflare's limit is 16 KB of Cache-Tag; stay well inside it. */
const MAX_TAGS = 400;

/**
 * Every entry and asset a render depended on, as cache tags: `e:<id>` for each, plus `site`.
 * A page that references too much to tag individually falls back to `site` (purged by any
 * structural change) plus its own content types.
 * @param {...any} roots delivered entries (with links embedded) and assets
 */
export function tagsFor(...roots: unknown[]): string[] {
  const ids = new Set<string>();
  const types = new Set<string>();
  const seen = new Set<unknown>();
  const walk = (value: unknown): void => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    const v = value as Record<string, unknown>;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (typeof v.id === 'string' && (v.fields || v.url)) {
      ids.add(v.id);
      if (typeof v.contentType === 'string' && v.fields) types.add(v.contentType);
    }
    Object.values(v).forEach(walk);
  };
  roots.forEach(walk);
  const tags = ['site', ...[...ids].map((id) => `e:${id}`)];
  if (tags.length <= MAX_TAGS) return tags.filter(validTag);
  return ['site', ...[...types].map((t) => `type:${t}`)].filter(validTag);
}

const validTag = (t: string): boolean => /^[\x21-\x7e]{1,1024}$/.test(t) && !t.includes(',');

/**
 * A strong validator for a render: the build plus the id and publish time of everything it used.
 * Same content, same ETag, so revalidations answer 304 without a body.
 */
export async function etagFor(buildId: string, ...roots: unknown[]): Promise<string> {
  const parts: string[] = [buildId];
  const seen = new Set<unknown>();
  const walk = (value: unknown): void => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    const v = value as Record<string, unknown>;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (typeof v.id === 'string') parts.push(`${v.id}@${v.publishedAt ?? v.url ?? ''}`);
    Object.values(v).forEach(walk);
  };
  roots.forEach(walk);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('|')));
  const hex = [...new Uint8Array(digest).slice(0, 12)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `"${hex}"`;
}

/** Origins of every asset a render links to, for a preconnect hint (the media host). */
export function assetOrigins(siteOrigin: string, ...roots: unknown[]): string[] {
  const origins = new Set<string>();
  const seen = new Set<unknown>();
  const walk = (value: unknown): void => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    const v = value as Record<string, unknown>;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (typeof v.url === 'string' && v.srcset) {
      try {
        const { origin } = new URL(v.url);
        if (origin !== siteOrigin) origins.add(origin);
      } catch {
        // not a URL
      }
    }
    Object.values(v).forEach(walk);
  };
  roots.forEach(walk);
  return [...origins].slice(0, 2);
}

/** A strong ETag over a finished body. */
export async function etagOfText(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return `"${[...new Uint8Array(digest).slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('')}"`;
}

/**
 * Whether an `If-None-Match` header matches an ETag, by the weak comparison RFC 9110 specifies
 * for it: `W/` is ignored, a list matches if any entry does, `*` matches anything. The gateway
 * hands browsers weak ETags (src/nonce.ts), so an exact string compare would never 304.
 */
export function etagMatches(ifNoneMatch: string | null, etag: string | null | undefined): boolean {
  if (!ifNoneMatch || !etag) return false;
  const opaque = (t: string) => t.trim().replace(/^W\//, '');
  const want = opaque(etag);
  return ifNoneMatch.split(',').some((t) => t.trim() === '*' || opaque(t) === want);
}
