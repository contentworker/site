import { BROWSER_HTML, EDGE_NOT_FOUND, EDGE_PAGE, NO_STORE } from './cache-policy.ts';

/**
 * CSP for every page. Pages are cached at the edge and shared, so a per-response nonce would be
 * shared too, which defeats it. Instead: scripts only from this origin (the starter has no
 * inline scripts; JSON-LD is data, not script), Trusted Types for DOM sinks, no plugins, no
 * <base> hijacking, no framing. A third party added in the delayed phase adds its origin here.
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

/**
 * The policy /__preview responses carry instead. Public pages may only be framed by the site
 * itself; preview pages only by the ContentWorker admin (live preview), never by the site or
 * anyone else, and by nobody when the admin origin isn't known. A live preview page (framed with
 * `cw_session`) also allows the Trusted Types policy `cw-preview`, which its script swaps
 * re-rendered blocks in through; no other page may create it.
 */
export function previewCsp(admin: string | null, live = false): string {
  return CSP_DIRECTIVES.map((d) =>
    d.startsWith('frame-ancestors ')
      ? `frame-ancestors ${admin ?? "'none'"}`
      : live && d.startsWith('trusted-types ')
        ? `${d} cw-preview`
        : d,
  ).join('; ');
}

/** Headers every /__preview response adds: its own CSP, no Referer, never indexed. */
export function previewHeaders(admin: string | null, live = false): Record<string, string> {
  return {
    'content-security-policy': previewCsp(admin, live),
    'referrer-policy': 'no-referrer',
    'x-robots-tag': 'noindex',
  };
}

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
 */
export interface HtmlHeaderOptions {
  kind: 'page' | 'not-found' | 'preview';
  tags?: string[];
  etag?: string | null;
  codeBase: string;
  preconnect?: string[];
  /** The admin origin allowed to frame a preview page (kind 'preview' only). */
  admin?: string | null;
  /** A live preview page (kind 'preview' with `cw_session`). */
  live?: boolean;
}

export function htmlHeaders({
  kind,
  tags = [],
  etag,
  codeBase,
  preconnect = [],
  admin = null,
  live = false,
}: HtmlHeaderOptions): Headers {
  const h = new Headers({ 'content-type': 'text/html; charset=utf-8', ...SECURITY });
  if (kind === 'preview') {
    h.set('cache-control', NO_STORE);
    for (const [k, v] of Object.entries(previewHeaders(admin, live))) h.set(k, v);
  } else {
    h.set('cache-control', BROWSER_HTML);
    // Edge-only TTL: Workers Caching reads it, browsers never see it.
    h.set('cloudflare-cdn-cache-control', kind === 'page' ? EDGE_PAGE : EDGE_NOT_FOUND);
    h.set('cache-tag', (kind === 'page' ? tags : ['site', 'notfound']).join(','));
  }
  if (etag) h.set('etag', etag);
  // Early Hints (when enabled on the zone) replays these before the HTML; browsers act on them
  // either way: start eager.css and open the media connection while the page is still arriving.
  h.set(
    'link',
    [
      `<${codeBase}/styles/eager.css>; rel=preload; as=style`,
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
