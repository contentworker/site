import { BROWSER_HTML, EDGE_NOT_FOUND, EDGE_PAGE, NO_STORE } from './cache-policy.ts';

/**
 * CSP for every page. Pages are cached at the edge and shared, so a per-response nonce would be
 * shared too, which defeats it. Instead: scripts only from this origin (the starter has no
 * inline scripts; JSON-LD is data, not script), Trusted Types for DOM sinks, no plugins, no
 * <base> hijacking, no framing. A third party added in the idle phase adds its origin here.
 */
export const CSP_DIRECTIVES = [
  "script-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'self'",
  "require-trusted-types-for 'script'",
  'trusted-types loader',
] as const;
/** The policy cached pages carry; the gateway upgrades it with a nonce (src/nonce.ts). */
export const CSP = CSP_DIRECTIVES.join('; ');

const SECURITY = {
  'content-security-policy': CSP,
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  'cross-origin-opener-policy': 'same-origin',
};

/**
 * Headers for an HTML page.
 * @param {{ kind: 'page' | 'not-found' | 'preview', tags?: string[], etag?: string,
 *   codeBase: string, preconnect?: string[] }} opts
 */
export interface HtmlHeaderOptions {
  kind: 'page' | 'not-found' | 'preview';
  tags?: string[];
  etag?: string | null;
  codeBase: string;
  preconnect?: string[];
}

export function htmlHeaders({
  kind,
  tags = [],
  etag,
  codeBase,
  preconnect = [],
}: HtmlHeaderOptions): Headers {
  const h = new Headers({ 'content-type': 'text/html; charset=utf-8', ...SECURITY });
  if (kind === 'preview') {
    h.set('cache-control', NO_STORE);
    h.set('x-robots-tag', 'noindex');
  } else {
    h.set('cache-control', BROWSER_HTML);
    // Edge-only TTL: Workers Caching reads it, browsers never see it.
    h.set('cloudflare-cdn-cache-control', kind === 'page' ? EDGE_PAGE : EDGE_NOT_FOUND);
    h.set('cache-tag', (kind === 'page' ? tags : ['site', 'notfound']).join(','));
  }
  if (etag) h.set('etag', etag);
  // Early Hints (when enabled on the zone) replays these before the HTML; browsers act on them
  // either way: start critical.css and open the media connection while the page is still arriving.
  h.set(
    'link',
    [
      `<${codeBase}/styles/critical.css>; rel=preload; as=style`,
      ...preconnect.map((o) => `<${o}>; rel=preconnect`),
    ].join(', '),
  );
  // Instant navigations: prefetch on hover, prerender on press. Rules are a static file.
  h.set('speculation-rules', `"${codeBase}/speculation-rules.json"`);
  return h;
}

export const textHeaders = (extra: Record<string, string> = {}): Record<string, string> => ({
  'content-type': 'text/plain; charset=utf-8',
  'cache-control': NO_STORE,
  'x-content-type-options': 'nosniff',
  ...extra,
});

/**
 * Headers for an edge-cached, non-HTML response (sitemaps, robots, llms, Markdown twins).
 * @param {{ contentType: string, tags: string[], etag?: string, edge?: string, extra?: Record<string, string> }} o
 */
export interface CachedHeaderOptions {
  contentType: string;
  tags: string[];
  etag?: string;
  edge?: string;
  extra?: Record<string, string>;
}

export function cachedHeaders({
  contentType,
  tags,
  etag,
  edge = EDGE_PAGE,
  extra = {},
}: CachedHeaderOptions): Headers {
  const h = new Headers({
    'content-type': contentType,
    'cache-control': BROWSER_HTML,
    'cloudflare-cdn-cache-control': edge,
    'cache-tag': tags.join(','),
    'x-content-type-options': 'nosniff',
    ...extra,
  });
  if (etag) h.set('etag', etag);
  return h;
}
