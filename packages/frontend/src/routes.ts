/**
 * Clean URLs, from one route table. Everything that needs a URL derives it from here: page
 * matching, links (`pathFor`), listings and their paging, sitemaps, llms.txt and Markdown twins.
 * ContentWorker slugs can't contain "/", so nesting is a route prefix, not a slug.
 *
 * Sites add routes with `defineSite({ routes })`; they're matched before the defaults, so the
 * catch-all `/:slug` page route stays last.
 */
import type { Entry } from './types.ts';

export const HOME_SLUG = 'home';
const SLUG = '([a-z0-9]+(?:-[a-z0-9]+)*)';

/** One entry per URL: `/:slug` paths render an entry; `list` paths render a paged listing. */
export type RouteDef =
  | {
      path: string;
      contentType: string /** The Slug field the :slug matches (default `slug`). */;
      slugField?: string;
    }
  | { path: string; list: string; title?: string; description?: string };

export const DEFAULT_ROUTES: readonly RouteDef[] = [
  { path: '/blog', list: 'article', title: 'Blog', description: 'Articles, newest first.' },
  { path: '/blog/:slug', contentType: 'article' },
  { path: '/:slug', contentType: 'page' },
];

export type RouteMatch =
  | { name: 'list'; list: string; page: number; base: string; title: string; description: string }
  | { name: 'entry' | 'home'; contentType: string; slug: string; slugField: string };

interface Compiled {
  def: RouteDef;
  pattern: RegExp;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function compile(def: RouteDef): Compiled {
  if (!/^\/[a-z0-9/:_-]*$/.test(def.path))
    throw new Error(`Route path "${def.path}" must be lowercase and start with /`);
  if ('list' in def) {
    // Paging lives in the path (/products/page/2): the edge cache key has no query string.
    return { def, pattern: new RegExp(`^${escapeRe(def.path)}(?:/page/([1-9][0-9]{0,3}))?$`) };
  }
  if ((def.path.match(/:slug/g) ?? []).length !== 1)
    throw new Error(`Route "${def.path}" needs exactly one :slug`);
  const [before = '', after = ''] = def.path.split(':slug');
  return { def, pattern: new RegExp(`^${escapeRe(before)}${SLUG}${escapeRe(after)}$`) };
}

/**
 * Three layers, first wins: the site's own routes (`defineSite({ routes })`), then the CMS's
 * (each content type's URL pattern, from Delivery's /routes), then the runtime's defaults. A
 * route for the same path or content type in an earlier layer replaces the later one.
 */
let siteRoutes: readonly RouteDef[] = [];
let cmsRoutes: readonly RouteDef[] = [];
let table: Compiled[] = DEFAULT_ROUTES.map(compile);

const sameRoute = (a: RouteDef, b: RouteDef) =>
  a.path === b.path ||
  ('contentType' in a && 'contentType' in b && a.contentType === b.contentType);

function rebuild(): void {
  const layers: RouteDef[] = [];
  for (const layer of [siteRoutes, cmsRoutes, DEFAULT_ROUTES]) {
    for (const r of layer) if (!layers.some((x) => sameRoute(x, r))) layers.push(r);
  }
  // Entry routes with a fixed prefix before catch-alls like `/:slug`, whatever layer they came from.
  const catchAll = (r: RouteDef) => 'contentType' in r && r.path.startsWith('/:');
  table = [...layers.filter((r) => !catchAll(r)), ...layers.filter(catchAll)].map(compile);
}

export function setRoutes(routes: readonly RouteDef[]): void {
  const next = routes.map(compile).map((c) => c.def); // validate before replacing anything
  siteRoutes = next;
  rebuild();
}

/**
 * Routes from ContentWorker URL patterns (`/{slug}`, `/shop/{handle}`). A pattern routes when it
 * names exactly one Slug field and nothing else; `{id}` and `{locale}` patterns don't map to a
 * single-locale site URL and are skipped.
 */
export function routesFromPatterns(
  items: readonly { contentType: string; urlPattern: string }[],
): RouteDef[] {
  const out: RouteDef[] = [];
  for (const { contentType, urlPattern } of items) {
    const names = [...urlPattern.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map((m) => m[1] ?? '');
    const field = names[0];
    if (names.length !== 1 || !field || field === 'id' || field === 'locale') continue;
    const path = urlPattern.replace(`{${field}}`, ':slug');
    try {
      compile({ path, contentType });
      out.push({ path, contentType, slugField: field });
    } catch {
      // not a path this runtime can route (uppercase, odd characters): skipped
    }
  }
  return out;
}

export function setCmsRoutes(routes: readonly RouteDef[]): void {
  cmsRoutes = routes;
  rebuild();
}

export function routes(): readonly RouteDef[] {
  return table.map((c) => c.def);
}

/** Content types that have their own URLs: the sitemap and llms.txt list these. */
export function routedTypes(): string[] {
  const types = new Set(table.flatMap((c) => ('contentType' in c.def ? [c.def.contentType] : [])));
  // Pages first: they're the site's spine in sitemaps and llms.txt.
  return [...types].sort((a, b) => Number(b === 'page') - Number(a === 'page'));
}

/** The listing route for a content type, if the site has one. */
export function listingFor(contentType: string): Extract<RouteDef, { list: string }> | null {
  for (const { def } of table) if ('list' in def && def.list === contentType) return def;
  return null;
}

/** Query parameters that never change a page and are dropped from the cache key. */
const TRACKING = /^(utm_[a-z]+|gclid|fbclid|msclkid|mc_[a-z]+|_ga)$/;

/**
 * The canonical form of a URL, and whether the request should be redirected to it.
 * Lowercase path, no trailing slash (except "/"), no ".html", no "/index".
 */
export function normalize(url: URL): { path: string; redirect: string | null } {
  let path = url.pathname.toLowerCase();
  path = path.replace(/\/index(\.html)?$/, '/').replace(/\.html$/, '');
  if (path.length > 1) path = path.replace(/\/+$/, '');
  path = path.replace(/\/{2,}/g, '/') || '/';
  if (path === `/${HOME_SLUG}`) path = '/';
  const redirect = path !== url.pathname ? path + url.search : null;
  return { path, redirect };
}

/** Search params that matter to rendering (none by default), with tracking ones stripped. */
export function cacheableSearch(url: URL): string {
  const kept = [...url.searchParams].filter(([k]) => !TRACKING.test(k));
  return kept.length ? `?${new URLSearchParams(kept.sort())}` : '';
}

/** The route for a normalized path. The home page is the `page` entry with slug "home". */
export function match(path: string): RouteMatch | null {
  if (path === '/')
    return { name: 'home', contentType: 'page', slug: HOME_SLUG, slugField: 'slug' };
  for (const { def, pattern } of table) {
    const m = pattern.exec(path);
    if (!m) continue;
    if ('list' in def) {
      return {
        name: 'list',
        list: def.list,
        page: Number(m[1] ?? 1),
        base: def.path,
        title: def.title ?? def.list,
        description: def.description ?? '',
      };
    }
    if (m[1])
      return {
        name: 'entry',
        contentType: def.contentType,
        slug: m[1],
        slugField: def.slugField ?? 'slug',
      };
  }
  return null;
}

/** The URL path of an entry, for links in rich text, navigation, sitemaps and llms.txt. */
export function pathFor(entry: Partial<Entry> | null | undefined): string | null {
  if (!entry?.fields || !entry.contentType) return null;
  for (const { def } of table) {
    if (!('contentType' in def) || def.contentType !== entry.contentType) continue;
    const slug = entry.fields[def.slugField ?? 'slug'];
    if (typeof slug !== 'string' || !slug) return null;
    if (entry.contentType === 'page' && slug === HOME_SLUG) return '/';
    return def.path.replace(':slug', slug);
  }
  return null;
}
