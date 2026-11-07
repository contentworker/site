import { assetOrigins, etagFor, etagMatches, tagsFor } from '../cache-policy.ts';
import type { Delivery } from '../delivery.ts';
import { htmlHeaders } from '../headers.ts';
import type { RouteMatch } from '../routes.ts';
import { match } from '../routes.ts';
import type { Entry, PreviewState, SiteEnv } from '../types.ts';
import { renderDocument } from './document.ts';

/** Page → section → fragment → its sections → their assets (Delivery allows five). */
const INCLUDE = 4;
const PER_PAGE = 20;

/**
 * A listing route as a synthetic page entry: one articleList section. Delivery has no total count,
 * so it asks for one extra item to know whether there's a next page. Tagged type:<list> through
 * the item entries' ids and the list's own synthetic tag.
 */
async function listing(
  delivery: Delivery,
  route: Extract<RouteMatch, { name: 'list' }>,
): Promise<(Entry & { listOf: string }) | null> {
  const items = await delivery.list(route.list, {
    order: '-fields.publishedAt',
    limit: PER_PAGE + 1,
    skip: (route.page - 1) * PER_PAGE,
    select: 'fields.title,fields.slug,fields.seo,fields.publishedAt,fields.body',
    include: 0,
  });
  if (!items.length && route.page > 1) return null;
  const more = items.length > PER_PAGE;
  return {
    id: `list:${route.list}:${route.page}`,
    contentType: 'listing',
    listOf: route.list,
    fields: {
      title: route.page > 1 ? `${route.title}, page ${route.page}` : route.title,
      seo: { description: route.description },
      sections: [
        {
          id: `list:${route.list}`,
          contentType: 'articleList',
          fields: {
            items: items.slice(0, PER_PAGE),
            page: route.page,
            base: route.base,
            pages: more ? route.page + 1 : route.page,
          },
        },
      ],
    },
  };
}

/**
 * Renders one page as a streamed Response. Head and header go out as soon as they're rendered,
 * then one chunk per section, so first byte doesn't wait for the whole page.
 */
export interface PageInput {
  env: SiteEnv;
  ctx: ExecutionContext;
  url: URL;
  path: string;
  delivery: Delivery;
  request: Request;
  preview?: PreviewState | undefined;
  /** The admin origin allowed to frame a preview render. */
  admin?: string | null | undefined;
}

export async function renderPage({
  env,
  ctx,
  url,
  path,
  delivery,
  request,
  preview,
  admin = null,
}: PageInput): Promise<Response> {
  const route = match(path);
  const [settings, main, footer, published] = await Promise.all([
    delivery.first('siteSettings', 2),
    delivery.menu('main'),
    delivery.menu('footer'),
    preview?.entry || !route
      ? null
      : route.name === 'list'
        ? listing(delivery, route)
        : delivery.findBySlug(route.contentType, route.slug, INCLUDE, route.slugField),
  ]);
  const menus = { main, footer };
  const entry = preview?.entry ?? published;
  const notFound = !entry;
  // Redirects only ever apply to paths without a page, so they cost nothing on a hit.
  if (notFound && !preview) {
    const redirect = await delivery.resolveRedirect(path);
    const response = redirect && redirectResponse(redirect, url, path);
    if (response) return response;
  }
  const codeBase = `/v/${env.BUILD_ID}`;
  const origin = env.SITE_ORIGIN || url.origin;
  // Menus carry no publish time, so their whole content goes into the validator: a saved menu
  // must not answer 304 with the old navigation.
  const etag = notFound
    ? null
    : await etagFor(env.BUILD_ID, entry, settings, { id: 'menus', url: JSON.stringify(menus) });
  const menuTag = main?.items?.length || footer?.items?.length ? ['menu'] : [];
  const headers = htmlHeaders({
    kind: preview ? 'preview' : notFound ? 'not-found' : 'page',
    tags:
      entry && 'listOf' in entry
        ? [...tagsFor(entry, settings), `type:${entry.listOf}`, ...menuTag]
        : [...tagsFor(entry, settings), ...menuTag],
    etag,
    codeBase,
    preconnect: assetOrigins(origin, entry),
    admin,
  });
  const status = notFound ? 404 : 200;

  if (etag && etagMatches(request.headers.get('if-none-match'), etag))
    return new Response(null, { status: 304, headers });
  if (request.method === 'HEAD') return new Response(null, { status, headers });

  const chunks = renderDocument({
    entry,
    settings,
    menus,
    url: new URL(path, url.origin),
    origin,
    codeBase,
    lang: delivery.locale,
    notFound,
    preview,
  });
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  ctx.waitUntil(
    (async () => {
      try {
        for await (const chunk of chunks) await writer.write(encoder.encode(chunk));
        await writer.close();
      } catch (error) {
        console.error(JSON.stringify({ msg: 'stream failed', path, error: String(error) }));
        await writer.abort(error);
      }
    })(),
  );
  return new Response(readable, { status, headers });
}

const STATUSES = new Set([301, 302, 307, 308]);

/** A ContentWorker redirect as a response, cached and purged like a page. */
function redirectResponse(
  redirect: { id: string; status: number; location: string },
  url: URL,
  from: string,
): Response | null {
  const to = redirect.location.trim();
  let location: URL;
  try {
    location = new URL(to, url.origin);
  } catch {
    return null;
  }
  if (
    !['http:', 'https:'].includes(location.protocol) ||
    (location.pathname === from && location.origin === url.origin)
  )
    return null;
  const status = STATUSES.has(redirect.status) ? redirect.status : 301;
  return new Response(null, {
    status,
    headers: {
      location: location.href,
      'cache-control': 'public, max-age=300',
      'cloudflare-cdn-cache-control': 'public, max-age=86400',
      // `redirects` is purged by redirects.changed; a slug change purges via its entry.published.
      'cache-tag': ['site', 'redirects', 'notfound'].join(','),
    },
  });
}
