import { EMBEDDED } from './assets.generated.ts';
import { IMMUTABLE } from './cache-policy.ts';
import type { SiteEnv } from './types.ts';

/**
 * Versioned code URLs. Pages reference /v/<BUILD_ID>/scripts/site.js and so on; this strips the
 * prefix and serves the file from the static assets as immutable. Relative imports inside the
 * modules (./lib.js, ../blocks/…) resolve under the same prefix, so every code file a page loads
 * is versioned with no build step: the base path, derived from import.meta.url, does cache
 * busting too.
 */
const VERSIONED = /^\/v\/([A-Za-z0-9._-]{1,64})(\/.+)$/;

export function isVersioned(pathname: string): boolean {
  return VERSIONED.test(pathname);
}

export async function serveVersioned(request: Request, env: SiteEnv, url: URL): Promise<Response> {
  const m = VERSIONED.exec(url.pathname);
  const build = m?.[1];
  const rest = m?.[2];
  if (!build || !rest) return new Response('Not found', { status: 404 });
  // The site's own files win (a site can override any runtime file by path); the runtime's
  // embedded browser files are the fallback, so a site needs no public/ of its own.
  const own = env.ASSETS
    ? await env.ASSETS.fetch(new Request(new URL(rest, url.origin), request))
    : null;
  let res = own?.ok ? own : embedded(rest);
  if (!res) return own ?? new Response('Not found', { status: 404 });
  // Theming: the site's public/styles/site.css (tokens, fonts, colours) rides on the end of the
  // runtime's eager.css, so it costs no extra request and its rules win. A site that replaced
  // eager.css outright keeps exactly its own file.
  if (rest === EAGER_CSS && !own?.ok && env.ASSETS)
    res = await withSiteCss(res, env.ASSETS, request, url);
  const headers = new Headers(res.headers);
  // A request for another build (a page cached across a deploy) gets today's file, so it must
  // not be cached as immutable under the old build's URL.
  const current = build === env.BUILD_ID;
  headers.set('cache-control', current ? IMMUTABLE : 'public, max-age=60');
  // A request for another build is not cached at the edge under that build's URL either.
  if (!current) headers.set('cloudflare-cdn-cache-control', 'no-store');
  headers.set('x-content-type-options', 'nosniff');
  // Speculation rules must be served with their own media type.
  if (rest === '/speculation-rules.json')
    headers.set('content-type', 'application/speculationrules+json');
  return new Response(res.body, { status: res.status, headers });
}

const EAGER_CSS = '/styles/eager.css';
export const SITE_CSS = '/styles/site.css';

async function withSiteCss(
  base: Response,
  assets: Fetcher,
  request: Request,
  url: URL,
): Promise<Response> {
  const site = await assets.fetch(new Request(new URL(SITE_CSS, url.origin), request));
  if (!site.ok) return base;
  const css = `${await base.text()}\n/* site.css */\n${await site.text()}`;
  return new Response(css, { headers: base.headers });
}

/** A runtime browser file from the bundle (scripts/embed-assets.ts), or null. */
function embedded(path: string): Response | null {
  const asset = EMBEDDED[path];
  if (!asset) return null;
  const body = asset.base64
    ? Uint8Array.from(atob(asset.body), (c) => c.charCodeAt(0))
    : asset.body;
  return new Response(body, { headers: { 'content-type': asset.type } });
}
