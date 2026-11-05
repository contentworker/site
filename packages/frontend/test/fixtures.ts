import { createRenderCtx } from '../src/render/block-ctx.ts';
import type { Asset, Entry, RichTextDocument, RichTextNode, SiteEnv } from '../src/types.ts';

/** Delivery-shaped fixtures (single-locale, links embedded), and a fake Delivery API. */

export const asset = (id: string, extra: Partial<Asset> = {}): Asset => ({
  id,
  kind: 'image',
  url: `https://media.example/${id}/o/${id}.jpg`,
  width: 2400,
  height: 1200,
  altText: `Alt for ${id}`,
  renditions: { og: `https://media.example/${id}/r-og/${id}.jpg` },
  srcset: [320, 640, 960, 1280, 1920].map((w) => ({
    width: w,
    url: `https://media.example/${id}/w${w}/${id}.jpg`,
  })),
  placeholder: { thumbhash: 'x', dominantColor: '#334455' },
  ...extra,
});

const t = (value: string, marks: string[] = []): RichTextNode => ({
  nodeType: 'text',
  value,
  marks: marks.map((type) => ({ type })),
});
export const doc = (...content: RichTextNode[]): RichTextDocument => ({
  nodeType: 'document',
  content,
});
export const p = (...content: RichTextNode[]): RichTextNode => ({ nodeType: 'paragraph', content });
export const text = t;

export const settings = {
  id: 'settings',
  contentType: 'siteSettings',
  fields: {
    name: 'ContentWorker',
    nav: [
      { label: 'Docs', link: { id: 'p-docs', contentType: 'page', fields: { slug: 'docs' } } },
      { label: 'Evil', url: 'javascript:alert(1)' },
    ],
    footer: doc(p(t('Built on Cloudflare.'))),
    llmsSummary: 'ContentWorker is a headless CMS on Cloudflare.',
  },
};

export const home = {
  id: 'p-home',
  contentType: 'page',
  publishedAt: '2026-10-30T10:00:00Z',
  fields: {
    title: 'Home',
    slug: 'home',
    seo: { description: 'A fast starter.' },
    sections: [
      {
        id: 'b-hero',
        contentType: 'hero',
        fields: {
          heading: 'Content, at the edge',
          lead: doc(
            p(t('Lead ')),
            p({
              nodeType: 'hyperlink',
              data: { uri: '/docs' },
              content: [t('Read the getting-started guide', ['bold'])],
            }),
          ),
          image: asset('a-hero'),
        },
      },
      {
        id: 'b-text',
        contentType: 'richText',
        fields: {
          body: doc({ nodeType: 'heading-2', content: [t('Why <fast>')] }, p(t('Second image: ')), {
            nodeType: 'embedded-asset-block',
            data: { target: asset('a-two') },
          }),
        },
      },
    ],
  },
};

export const about = {
  id: 'p-about',
  contentType: 'page',
  fields: { title: 'About', slug: 'about', body: doc(p(t('About us, in plain words.'))) },
};

export const hidden = {
  id: 'p-hidden',
  contentType: 'page',
  fields: {
    title: 'Hidden',
    slug: 'hidden',
    seo: { noindex: true },
    body: doc(p(t('Not for crawlers.'))),
  },
};

export const article = {
  id: 'a-1',
  contentType: 'article',
  publishedAt: '2026-10-31T09:00:00Z',
  fields: {
    title: 'Edge rendering, explained',
    slug: 'edge-rendering',
    author: { id: 'person-1', contentType: 'person', fields: { name: 'Sam Rivera' } },
    body: doc(
      p(t('Rendering at the edge means '), t('no origin', ['bold']), t('.')),
      { nodeType: 'heading-2', content: [t('Why')] },
      {
        nodeType: 'unordered-list',
        content: [
          { nodeType: 'list-item', content: [p(t('Fast'))] },
          { nodeType: 'list-item', content: [p(t('Cheap'))] },
        ],
      },
      p({
        nodeType: 'entry-hyperlink',
        data: { target: { id: 'p-about', contentType: 'page', fields: { slug: 'about' } } },
        content: [t('About us')],
      }),
    ),
  },
};

const faqBlock = {
  id: 'b-faq',
  contentType: 'faq',
  fields: {
    heading: 'Questions',
    items: [
      { question: 'Is it fast?', answer: doc(p(t('Yes, it is served from the edge.'))) },
      { question: 'Does it need JS?', answer: doc(p(t('No.'))) },
    ],
  },
};

export const blocksPage = {
  id: 'p-blocks',
  contentType: 'page',
  fields: {
    title: 'Blocks',
    slug: 'blocks',
    sections: [
      {
        id: 'b-cards',
        contentType: 'cards',
        fields: {
          heading: 'Cards',
          items: [
            {
              title: 'One',
              body: doc(p(t('First card'))),
              image: asset('a-c1'),
              link: { id: 'p-about', contentType: 'page', fields: { slug: 'about' } },
            },
            { title: 'Two', body: doc(p(t('Second card'))) },
          ],
        },
      },
      {
        id: 'b-cols',
        contentType: 'columns',
        fields: { columns: [{ body: doc(p(t('Left'))) }, { image: asset('a-col') }] },
      },
      {
        id: 'frag-1',
        contentType: 'fragment',
        fields: {
          title: 'Shared',
          sections: [
            {
              id: 'b-cta',
              contentType: 'cta',
              fields: {
                heading: 'Start now',
                label: 'Get started',
                url: '/docs',
                variant: 'primary',
              },
            },
            faqBlock,
          ],
        },
      },
      {
        id: 'b-media',
        contentType: 'media',
        fields: {
          caption: 'A video',
          asset: {
            id: 'v-1',
            kind: 'video',
            url: 'https://media.example/v.m3u8',
            width: 1280,
            height: 720,
            title: 'Demo',
            video: {
              hlsUrl: 'https://stream.example/v.m3u8',
              thumbnailUrl: 'https://stream.example/thumb.jpg',
            },
          },
        },
      },
    ],
  },
};

/** The same kind of page, built the way the seed model does it: a ContentWorker blocks field. */
export const inlinePage = {
  id: 'p-inline',
  contentType: 'page',
  fields: {
    title: 'Inline',
    slug: 'inline',
    sections: [
      { _type: 'hero', _key: 'k-hero', heading: 'Inline hero', image: asset('a-inline') },
      {
        _type: 'faq',
        _key: 'k-faq',
        heading: 'Asked',
        items: [{ question: 'Inline?', answer: doc(p(t('Yes.'))) }],
      },
      { _type: 'nope', _key: 'k-unknown', text: 'an unknown variant renders nothing' },
    ],
  },
};

/** ContentWorker redirects, as Delivery's /redirects/resolve answers them. */
export const redirects = [
  { id: 'r-1', source: '/old-about', destination: '/about', status: 308 },
  { id: 'r-2', source: '/evil', destination: 'javascript:alert(1)', status: 301 },
];

/** A fetch that answers Delivery list queries from the fixtures above. */
export function fakeDelivery({
  fail = false,
  extra = {},
  routes,
}: {
  fail?: boolean;
  extra?: Record<string, Entry[]>;
  /** Delivery's /routes answer; absent, /routes is a 404 (a ContentWorker without it). */
  routes?: { contentType: string; urlPattern: string }[];
} = {}) {
  const calls: { url: URL; init: RequestInit & { headers: Record<string, string> } }[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    calls.push({ url, init: init as RequestInit & { headers: Record<string, string> } });
    if (fail) return new Response('boom', { status: 500 });
    const type = url.searchParams.get('content_type');
    const slug = url.searchParams.get('fields.slug');
    const skip = Number(url.searchParams.get('skip') ?? 0);
    const limit = Number(url.searchParams.get('limit') ?? 100);
    let items: Entry[] = [];
    if (type === 'siteSettings') items = [settings];
    if (type === 'page')
      items = [home, about, hidden, blocksPage, inlinePage].filter(
        (e) => !slug || e.fields.slug === slug,
      );
    if (type === 'article') items = [article].filter((e) => !slug || e.fields.slug === slug);
    if (url.pathname.endsWith('/routes')) {
      return routes
        ? Response.json({ items: routes, total: routes.length })
        : Response.json({ error: 'not found' }, { status: 404 });
    }
    if (url.pathname.endsWith('/redirects/resolve')) {
      const r = redirects.find((x) => x.source === url.searchParams.get('path'));
      if (!r) return Response.json({ error: 'not found' }, { status: 404 });
      return Response.json({ redirect: { id: r.id }, status: r.status, location: r.destination });
    }
    if (type && extra[type])
      items = (extra[type] ?? []).filter((e) => !slug || e.fields.slug === slug);
    items = items.slice(skip, skip + limit);
    return Response.json({ items, total: items.length });
  };
  return { fetch, calls };
}

export function env(overrides: Record<string, unknown> = {}): SiteEnv {
  return {
    CONTENTWORKER: 'site/main',
    CONTENTWORKER_KEY: 'cda_test',
    SITE_ORIGIN: 'https://contentworker.site',
    BUILD_ID: 'abc123',
    ASSETS: {
      fetch: async () => new Response('/* css */', { headers: { 'content-type': 'text/css' } }),
    },
    ...overrides,
  } as unknown as SiteEnv;
}

/** An ExecutionContext for node tests: waitUntil promises are collected so tests can await them. */
// biome-ignore lint/suspicious/noExplicitAny: test doubles for runtime-provided loopback bindings.
export type TestCtx = ExecutionContext & { pending: Promise<unknown>[]; exports: any; cache?: any };

export function execCtx(): TestCtx {
  const pending: Promise<unknown>[] = [];
  return {
    waitUntil: (p: Promise<unknown>) => {
      pending.push(p);
    },
    passThroughOnException() {},
    pending,
    props: {},
    exports: {},
  } as unknown as TestCtx;
}

/**
 * The gateway's ctx, with ctx.exports wired like the runtime does: Site is a real instance (no
 * cache in node, so every request is a "miss"), PurgeQueue records what was enqueued.
 */
type SiteLike = {
  fetch(req: Request): Promise<Response>;
  purge(o: CachePurgeOptions): Promise<unknown>;
};

export async function world(
  SiteClass: new (ctx: ExecutionContext, env: SiteEnv) => SiteLike,
  envValue: SiteEnv,
) {
  const ctx = execCtx();
  const enqueued: string[][] = [];
  const purges: CachePurgeOptions[] = [];
  const siteCtx = execCtx();
  siteCtx.cache = {
    purge: async (opts: CachePurgeOptions) => {
      purges.push(opts);
      return { success: true, errors: [] };
    },
  };
  siteCtx.pending = ctx.pending;
  const site = new SiteClass(siteCtx, envValue);
  ctx.exports = {
    Site: {
      fetch: (req: Request) => site.fetch(req),
      purge: (o: CachePurgeOptions) => site.purge(o),
    },
    PurgeQueue: {
      idFromName: (n: string) => n,
      get: () => ({
        add: async (tags: string[]) => {
          enqueued.push(tags);
        },
      }),
    },
  };
  return { ctx, enqueued, purges, site };
}

/** A render context like the document's, for testing a block on its own. */
export const blockCtx = (opts: { path?: string; origin?: string } = {}) =>
  createRenderCtx({ origin: 'https://contentworker.site', ...opts });

/** The value, or a failed assertion: for regex matches and lookups that must succeed in a test. */
export function must<T>(value: T | null | undefined, what = 'value'): T {
  if (value == null) throw new Error(`expected ${what}`);
  return value;
}
