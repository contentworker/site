import { WorkerEntrypoint } from 'cloudflare:workers';
import { isVersioned } from './assets.ts';
import { ensureCmsRoutes } from './cms-routes.ts';
import { backend, ConfigError } from './config.ts';
import { createDelivery, DeliveryError } from './delivery.ts';
import { textHeaders } from './headers.ts';
import { hostRedirect } from './host.ts';
import { withNonce } from './nonce.ts';
import { handlePreview, PREFIX as PREVIEW } from './preview.ts';
import { renderPage } from './render/page.ts';
import { match, normalize } from './routes.ts';
import { serveSite } from './site.ts';
import type { SiteEnv } from './types.ts';
import { handleWebhook } from './webhook.ts';

export { PurgeQueue } from './purge-queue.ts';

/**
 * Two entrypoints (wrangler.jsonc `exports`):
 *
 *   default  the gateway. Uncached, runs on every request, does no I/O on the hot path:
 *            the www twin to the canonical host, canonical path redirects, the webhook,
 *            preview, /health, then hands everything else to
 *            Site with tracking parameters, cookies and credentials stripped.
 *   Site     cached by Workers Caching. A hit is served from Cloudflare's tiered edge cache
 *            without running it; a miss renders from the Delivery API and is stored, tagged
 *            with every entry and asset it used.
 *
 * Static files in public/ are served before either runs.
 */
export const gateway = {
  async fetch(request: Request, env: SiteEnv, ctx: ExecutionContext): Promise<Response> {
    // Every HTML response leaves with this visitor's own CSP nonce (src/nonce.ts).
    return withNonce(await route(request, env, ctx));
  },
};

async function route(request: Request, env: SiteEnv, ctx: ExecutionContext): Promise<Response> {
  {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/health') return new Response('ok', { headers: textHeaders() });
      const moved = hostRedirect(request, url, env.SITE_ORIGIN);
      if (moved) return moved;
      if (url.pathname === '/__cw/webhook') {
        if (request.method !== 'POST')
          return new Response('Method not allowed', {
            status: 405,
            headers: textHeaders({ allow: 'POST' }),
          });
        return await handleWebhook(request, {
          secret: env.CONTENTWORKER_WEBHOOK_SECRET,
          enqueue: (tags) =>
            ctx.exports.PurgeQueue.get(ctx.exports.PurgeQueue.idFromName('purge')).add(tags),
        });
      }
      const previewing = url.pathname === PREVIEW || url.pathname.startsWith(`${PREVIEW}/`);
      // POST /__preview (the fragment handoff) and /__preview/render are the only other methods.
      const read = request.method === 'GET' || request.method === 'HEAD';
      if (!read && !(previewing && request.method === 'POST')) {
        return new Response('Method not allowed', {
          status: 405,
          headers: textHeaders({ allow: 'GET, HEAD' }),
        });
      }
      if (previewing) {
        const cw = backend(env);
        await ensureCmsRoutes(createDelivery(cw));
        return await handlePreview({
          request,
          url,
          cw,
          site: { origin: env.SITE_ORIGIN || url.origin, codeBase: `/v/${env.BUILD_ID}` },
          render: ({ path, preview, admin }) =>
            renderPage({
              env,
              ctx,
              url,
              path,
              request,
              preview,
              admin,
              delivery: createDelivery(cw),
            }),
        });
      }
      if (!isVersioned(url.pathname)) {
        const { redirect } = normalize(url);
        if (redirect) return Response.redirect(new URL(redirect, url.origin).href, 301);
      }
      return await negotiated(request, url, (req) => ctx.exports.Site.fetch(req));
    } catch (error) {
      return failure(error, url);
    }
  }
}

export class Site extends WorkerEntrypoint<SiteEnv> {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      return await serveSite(request, this.env, this.ctx, url);
    } catch (error) {
      return failure(error, url);
    }
  }

  /** Called by PurgeQueue over RPC (RPC bypasses the cache); purges this entrypoint's cache. */
  async purge(options: CachePurgeOptions): Promise<CachePurgeResult> {
    if (!this.ctx.cache) throw new Error('Workers Caching is not enabled for the Site entrypoint');
    const result = await this.ctx.cache.purge(options);
    if (!result?.success) throw new Error(`purge failed: ${JSON.stringify(result?.errors ?? [])}`);
    return result;
  }
}

/**
 * Pages answer `Accept: text/markdown` with their Markdown twin. The choice is made here, before
 * the cache, by rewriting to the .md URL, so the cached entries never Vary on Accept (browser
 * Accept strings would split the cache). The response to the client does say Vary: Accept.
 */
async function negotiated(
  request: Request,
  url: URL,
  site: (req: Request) => Promise<Response>,
): Promise<Response> {
  const page = !isVersioned(url.pathname) && match(normalize(url).path);
  if (!page) return site(forCache(request, url));
  const md = wantsMarkdown(request.headers.get('accept'));
  const target = new URL(url);
  if (md) target.pathname = normalize(url).path === '/' ? '/index.md' : `${normalize(url).path}.md`;
  const res = await site(forCache(request, target));
  const out = new Response(res.body, res);
  out.headers.append('vary', 'Accept');
  return out;
}

/** True when the client prefers Markdown to HTML (an agent, not a browser). */
export function wantsMarkdown(accept: string | null | undefined): boolean {
  if (!accept) return false;
  const types = accept.split(',').map((part) => {
    const [type, ...params] = part.trim().toLowerCase().split(';');
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    return { type, q: q ? Number(q.slice(2)) : 1 };
  });
  const md = types.find((t) => t.type === 'text/markdown');
  if (!md || md.q === 0) return false;
  const html = types.find((t) => t.type === 'text/html');
  return !html || md.q > html.q || (md.q === html.q && types.indexOf(md) < types.indexOf(html));
}

/**
 * The request Site sees, and so the cache key: the canonical path with no query string (pages
 * don't read it; scripts still see the real URL in the browser), and no cookies or credentials,
 * which would otherwise make the cache bypass.
 */
function forCache(request: Request, url: URL): Request {
  const clean = new URL(url);
  clean.search = '';
  if (!isVersioned(url.pathname)) clean.pathname = normalize(url).path;
  const headers = new Headers(request.headers);
  headers.delete('cookie');
  headers.delete('authorization');
  return new Request(clean, { method: request.method, headers });
}

function failure(error: unknown, url: URL): Response {
  console.error(
    JSON.stringify({ msg: 'request failed', path: url.pathname, error: String(error) }),
  );
  if (error instanceof ConfigError) {
    // Say what's wrong locally; never leak configuration on a public host.
    const local = /^(localhost|127\.0\.0\.1)$/.test(url.hostname);
    return new Response(local ? `Configuration: ${error.message}` : 'Site misconfigured.', {
      status: 500,
      headers: textHeaders(),
    });
  }
  const status = error instanceof DeliveryError ? 503 : 500;
  return new Response('This page is temporarily unavailable. Please try again shortly.', {
    status,
    headers: textHeaders({ 'retry-after': '30' }),
  });
}

/** The gateway as a default export (tests import the module directly). */
export default gateway;
