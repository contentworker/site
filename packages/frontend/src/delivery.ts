import type { Backend } from './config.ts';
import type { Entry, Menu } from './types.ts';

/**
 * A small client for the ContentWorker Delivery API, in the spirit of `@contentworker/sdk/edge`:
 * one locale (field values come back flat), bearer auth, plain fetch. The key is a Worker secret
 * and never reaches the browser.
 */

export class DeliveryError extends Error {
  readonly status: number;
  constructor(status: number, url: string) {
    super(`delivery ${status} for ${url}`);
    this.status = status;
  }
}

export interface ListOptions {
  order?: string;
  limit?: number;
  skip?: number;
  select?: string;
  include?: number;
}

export interface IterateOptions {
  select?: string;
  include?: number;
  pageSize?: number;
  max?: number;
}

interface EntryList {
  items?: Entry[];
  total?: number;
}

export type Delivery = ReturnType<typeof createDelivery>;

export function createDelivery(cw: Backend, opts: { fetch?: typeof fetch } = {}) {
  const base = cw.base;
  const doFetch = opts.fetch ?? cw.fetch;
  const headers = { authorization: `Bearer ${cw.key}`, accept: 'application/json' };
  const locale = cw.locale;

  async function get<T>(path: string, params: Record<string, string> = {}): Promise<T | null> {
    const qs = new URLSearchParams({ locale, ...params });
    const url = `${base}${path}?${qs}`;
    const res = await doFetch(url, { headers });
    if (res.status === 404) return null;
    if (!res.ok) throw new DeliveryError(res.status, `${base}${path}`);
    return (await res.json()) as T;
  }

  return {
    locale,

    /** The one entry of a type whose slug matches, with links embedded to `include` levels. */
    async findBySlug(
      contentType: string,
      slug: string,
      include = 3,
      slugField = 'slug',
    ): Promise<Entry | null> {
      const res = await get<EntryList>('/entries', {
        content_type: contentType,
        [`fields.${slugField}`]: slug,
        include: String(include),
        limit: '1',
      });
      return res?.items?.[0] ?? null;
    },

    async getEntry(id: string, include = 3): Promise<Entry | null> {
      return get<Entry>(`/entries/${encodeURIComponent(id)}`, { include: String(include) });
    },

    /** One page of entries of a type, in `order` (e.g. "-fields.publishedAt"). */
    async list(
      contentType: string,
      { order, limit = 20, skip = 0, select, include = 1 }: ListOptions = {},
    ): Promise<Entry[]> {
      const params: Record<string, string> = {
        content_type: contentType,
        limit: String(limit),
        skip: String(skip),
        include: String(include),
      };
      if (order) params.order = order;
      if (select) params.select = select;
      const res = await get<EntryList>('/entries', params);
      return res?.items ?? [];
    },

    /**
     * ContentWorker's own redirects (managed in the CMS, plus the ones a slug change writes):
     * where `path` goes, or null. Exact sources and `[param]`/`[...splat]` patterns resolve there.
     */
    async resolveRedirect(
      path: string,
    ): Promise<{ id: string; status: number; location: string } | null> {
      const res = await get<{ redirect: { id: string }; status: number; location: string }>(
        '/redirects/resolve',
        { path },
      );
      return res ? { id: res.redirect.id, status: res.status, location: res.location } : null;
    },

    /**
     * The space's URL patterns, one per routed content type (`GET /routes`), or null when this
     * ContentWorker doesn't serve them yet.
     */
    async routes(): Promise<{ contentType: string; urlPattern: string }[] | null> {
      const res = await get<{ items?: { contentType: string; urlPattern: string }[] }>('/routes');
      return res?.items ?? null;
    },

    /** A navigation menu by handle, resolved for the locale; null when there's no such menu. */
    async menu(handle: string): Promise<Menu | null> {
      return get<Menu>(`/menus/${encodeURIComponent(handle)}`);
    },

    /** The first entry of a singleton type (siteSettings). */
    async first(contentType: string, include = 2): Promise<Entry | null> {
      const res = await get<EntryList>('/entries', {
        content_type: contentType,
        include: String(include),
        limit: '1',
      });
      return res?.items?.[0] ?? null;
    },

    /**
     * Every entry of a type, page by page. Delivery's `total` is the page size, so a short page
     * is the end.
     */
    async *iterate(
      contentType: string,
      { select, include, pageSize = 100, max = Number.POSITIVE_INFINITY }: IterateOptions = {},
    ): AsyncGenerator<Entry> {
      let seen = 0;
      for (let skip = 0; ; skip += pageSize) {
        const params: Record<string, string> = {
          content_type: contentType,
          limit: String(pageSize),
          skip: String(skip),
        };
        if (select) params.select = select;
        if (include != null) params.include = String(include);
        const res = await get<EntryList>('/entries', params);
        const items = res?.items ?? [];
        for (const item of items) {
          if (seen >= max) return;
          seen += 1;
          yield item;
        }
        if (items.length < pageSize) return;
      }
    },
  };
}
