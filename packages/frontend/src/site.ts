import { isVersioned, serveVersioned } from './assets.ts';
import { etagMatches, etagOfText, NO_STORE, tagsFor } from './cache-policy.ts';
import { ensureCmsRoutes } from './cms-routes.ts';
import { backend } from './config.ts';
import type { Delivery } from './delivery.ts';
import { createDelivery } from './delivery.ts';
import { cachedHeaders } from './headers.ts';
import { markdownFor } from './render/blocks.ts';
import { pageMarkdown } from './render/markdown.ts';
import { renderPage } from './render/page.ts';
import { firstParagraph } from './render/richtext.ts';
import { match, routedTypes } from './routes.ts';
import { llmsFullTxt, llmsTxt } from './seo/llms.ts';
import { robotsTxt } from './seo/robots.ts';
import { sitemapFile, sitemapIndex } from './seo/sitemap.ts';
import type { SiteEnv } from './types.ts';

/**
 * Everything the cached Site entrypoint answers: versioned code, the machine-readable surface
 * (robots, sitemaps, llms.txt, Markdown twins) and pages. All of it is edge-cached and tagged,
 * so a publish purges lists (`type:<contentType>`) as well as the pages themselves.
 */
const SITEMAP_FILE = /^\/sitemaps\/([a-zA-Z][a-zA-Z0-9]*)-([1-9][0-9]*)\.xml$/;
/** Lists (sitemaps, llms.txt) are purged by every publish of a routed type. */
const typeTags = () => routedTypes().map((t) => `type:${t}`);
/** Page → section → fragment → its sections → their assets: four levels (Delivery allows five). */
export const INCLUDE = 4;

type TextResponder = (
  body: string | null,
  contentType?: string,
  tags?: string[],
  extra?: Record<string, string>,
) => Promise<Response>;

export async function serveSite(
  request: Request,
  env: SiteEnv,
  ctx: ExecutionContext,
  url: URL,
): Promise<Response> {
  if (isVersioned(url.pathname)) return serveVersioned(request, env, url);
  const delivery = createDelivery(backend(env));
  await ensureCmsRoutes(delivery);
  const origin = env.SITE_ORIGIN || url.origin;
  const path = url.pathname;

  const text: TextResponder = async (
    body,
    contentType = 'text/plain; charset=utf-8',
    tags = ['site'],
    extra = {},
  ) => {
    if (body == null)
      return new Response('Not found', {
        status: 404,
        headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': NO_STORE },
      });
    const etag = await etagOfText(body);
    const headers = cachedHeaders({ contentType, tags, etag, extra });
    if (etagMatches(request.headers.get('if-none-match'), etag))
      return new Response(null, { status: 304, headers });
    return new Response(request.method === 'HEAD' ? null : body, { headers });
  };

  if (path === '/robots.txt') {
    const settings = await delivery.first('siteSettings', 0);
    return text(robotsTxt({ origin, settings }), 'text/plain; charset=utf-8', tagsFor(settings));
  }
  if (path === '/sitemap.xml') {
    return text(await sitemapIndex({ delivery, origin }), 'application/xml; charset=utf-8', [
      'site',
      ...typeTags(),
    ]);
  }
  const file = SITEMAP_FILE.exec(path);
  if (file) {
    const type = file[1] ?? '';
    const body = await sitemapFile({ delivery, origin, type, part: Number(file[2]) });
    return text(body, 'application/xml; charset=utf-8', ['site', `type:${type}`]);
  }
  if (path === '/llms.txt') {
    const settings = await delivery.first('siteSettings', 0);
    return text(await llmsTxt({ delivery, origin, settings }), 'text/plain; charset=utf-8', [
      ...tagsFor(settings),
      ...typeTags(),
    ]);
  }
  if (path === '/llms-full.txt') {
    return text(await llmsFullTxt({ delivery, origin, markdownFor }), 'text/plain; charset=utf-8', [
      'site',
      ...typeTags(),
    ]);
  }
  if (path.endsWith('.md')) return markdownTwin({ path, delivery, origin, text });

  return renderPage({ env, ctx, url, path, request, delivery });
}

/** /about.md, /index.md (home), /blog/x.md: the page as Markdown, canonical to its HTML. */
async function markdownTwin({
  path,
  delivery,
  origin,
  text,
}: {
  path: string;
  delivery: Delivery;
  origin: string;
  text: TextResponder;
}): Promise<Response> {
  const pagePath = path === '/index.md' ? '/' : path.slice(0, -3);
  const route = match(pagePath);
  const entry =
    route && route.name !== 'list'
      ? await delivery.findBySlug(route.contentType, route.slug, INCLUDE, route.slugField)
      : null;
  if (!entry || entry.fields?.seo?.noindex) return text(null);
  const description = entry.fields?.seo?.description || firstParagraph(entry.fields?.body);
  return text(
    pageMarkdown(entry, { origin, description, markdownFor }),
    'text/markdown; charset=utf-8',
    tagsFor(entry),
    {
      link: `<${origin}${pagePath}>; rel="canonical"`,
    },
  );
}
