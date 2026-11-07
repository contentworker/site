import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defineSite, type Entry, html, type RenderCtx, Site } from '../src/index.ts';
import { BLOCKS, CHROME } from '../src/render/blocks.ts';
import { setRoutes } from '../src/routes.ts';
import { doc, env, fakeDelivery, p, text, world } from './fixtures.ts';

/** A site with no public/ of its own: no ASSETS binding at all. */
async function get(
  path: string,
  overrides: Record<string, unknown> = {},
  extra: Record<string, Entry[]> = {},
) {
  const delivery = fakeDelivery({ extra });
  const e = env({ CONTENTWORKER_DELIVERY: delivery, ASSETS: undefined, ...overrides });
  const w = await world(Site, e);
  const res = await defineSite().fetch?.(
    new Request(`https://contentworker.site${path}`) as never,
    e as never,
    w.ctx,
  );
  const body = res?.status === 200 ? await res.text() : '';
  await Promise.all(w.ctx.pending);
  return { res: res as Response, body };
}

test('a site with no files of its own serves the runtime’s scripts, styles and block CSS', async () => {
  for (const [path, type] of [
    ['/v/abc123/scripts/boot.js', 'text/javascript; charset=utf-8'],
    ['/v/abc123/styles/critical.css', 'text/css; charset=utf-8'],
    ['/v/abc123/blocks/cards/cards.css', 'text/css; charset=utf-8'],
    ['/v/abc123/speculation-rules.json', 'application/speculationrules+json'],
  ] as const) {
    const { res, body } = await get(path);
    assert.equal(res.status, 200, path);
    assert.equal(res.headers.get('content-type'), type, path);
    assert.equal(res.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.ok(body.length > 0);
  }
  assert.equal(
    (await get('/v/abc123/blocks/cards/cards.render.ts')).res.status,
    404,
    'server code is never served',
  );
  assert.equal((await get('/v/abc123/nope.js')).res.status, 404);
});

test('the site’s own file wins over the runtime’s at the same path', async () => {
  const ASSETS = {
    fetch: async (r: Request) =>
      new URL(r.url).pathname === '/styles/critical.css'
        ? new Response(':root{--x:1}')
        : new Response('', { status: 404 }),
  };
  const own = await get('/v/abc123/styles/critical.css', { ASSETS });
  assert.equal(own.body, ':root{--x:1}');
  const fallback = await get('/v/abc123/styles/deferred.css', { ASSETS });
  assert.match(fallback.body, /table/);
});

test('defineSite adds and replaces blocks, and replaces the header', async () => {
  const heroBefore = BLOCKS.get('hero');
  const headerBefore = CHROME.header;
  try {
    defineSite({
      blocks: [
        {
          name: 'hero',
          contentType: 'hero',
          css: false,
          js: false,
          default: (entry: Entry) => html`<p class="custom-hero">${entry.fields.heading}</p>`,
        },
      ],
      header: {
        name: 'header',
        css: false,
        js: false,
        default: (_s: Entry | null, _c: RenderCtx) => html`<nav>Custom</nav>`,
      },
    });
    const { body } = await get('/');
    assert.match(body, /<p class="custom-hero">Content, at the edge<\/p>/);
    assert.match(body, /<header><div class="header block"[^>]*><nav>Custom<\/nav>/);
  } finally {
    if (heroBefore) BLOCKS.set('hero', heroBefore);
    CHROME.header = headerBefore;
  }
});

test('defineSite routes: a new content type gets pages, a listing, sitemap and twins', async () => {
  const product: Entry = {
    id: 'prod-1',
    contentType: 'product',
    publishedAt: '2026-10-01T00:00:00Z',
    fields: { title: 'Red chair', slug: 'red-chair', body: doc(p(text('A very red chair.'))) },
  };
  const extra = { product: [product] };
  try {
    defineSite({
      routes: [
        { path: '/products/:slug', contentType: 'product' },
        {
          path: '/products',
          list: 'product',
          title: 'Products',
          description: 'Everything we make.',
        },
      ],
    });
    const page = await get('/products/red-chair', {}, extra);
    assert.equal(page.res.status, 200);
    assert.match(page.body, /<h1>Red chair<\/h1><p>A very red chair.<\/p>/);
    assert.match(
      page.body,
      /<link rel="canonical" href="https:\/\/contentworker.site\/products\/red-chair">/,
    );
    const list = await get('/products', {}, extra);
    assert.match(list.body, /<h1>Products<\/h1>/);
    assert.match(list.body, /<a href="\/products\/red-chair">Red chair<\/a>/);
    assert.match(list.body, /<meta name="description" content="Everything we make.">/);
    const index = await get('/sitemap.xml', {}, extra);
    assert.match(index.body, /sitemaps\/product-1.xml/);
    const sitemap = await get('/sitemaps/product-1.xml', {}, extra);
    assert.match(sitemap.body, /<loc>https:\/\/contentworker.site\/products<\/loc>/);
    assert.match(sitemap.body, /<loc>https:\/\/contentworker.site\/products\/red-chair<\/loc>/);
    const md = await get('/products/red-chair.md', {}, extra);
    assert.match(md.body, /^# Red chair\n/);
  } finally {
    setRoutes([]);
  }
});

test('routes load from the CMS (Delivery /routes); without the endpoint, defaults keep working', async () => {
  const { resetCmsRoutes } = await import('../src/cms-routes.ts');
  const product: Entry = {
    id: 'prod-2',
    contentType: 'product',
    fields: { title: 'Lamp', handle: 'lamp', body: doc(p(text('A lamp.'))) },
  };
  const run = async (path: string, routes?: { contentType: string; urlPattern: string }[]) => {
    const delivery = fakeDelivery({ extra: { product: [product] }, ...(routes ? { routes } : {}) });
    const e = env({ CONTENTWORKER_DELIVERY: delivery, ASSETS: undefined });
    const w = await world(Site, e);
    const res = await defineSite().fetch?.(
      new Request(`https://contentworker.site${path}`) as never,
      e as never,
      w.ctx,
    );
    const body = res?.status === 200 ? await res.text() : '';
    await Promise.all(w.ctx.pending);
    return { res: res as Response, body, calls: delivery.calls };
  };
  try {
    resetCmsRoutes();
    const routed = await run('/shop/lamp', [
      { contentType: 'page', urlPattern: '/{slug}' },
      { contentType: 'article', urlPattern: '/blog/{slug}' },
      { contentType: 'product', urlPattern: '/shop/{handle}' },
    ]);
    assert.equal(routed.res.status, 200);
    assert.match(routed.body, /<h1>Lamp<\/h1>/);
    assert.ok(
      routed.calls.some((c) => c.url.searchParams.get('fields.handle') === 'lamp'),
      'looked up by the pattern’s Slug field',
    );
    const sitemap = await run('/sitemaps/product-1.xml', [
      { contentType: 'product', urlPattern: '/shop/{handle}' },
    ]);
    assert.match(sitemap.body, /<loc>https:\/\/contentworker.site\/shop\/lamp<\/loc>/);

    resetCmsRoutes();
    const old = await run('/about');
    assert.equal(old.res.status, 200, 'a CMS without /routes falls back to the defaults');
    assert.equal((await run('/shop/lamp')).res.status, 404);
  } finally {
    resetCmsRoutes();
  }
});

test('theming: the site’s styles/site.css is appended to critical.css, in the same response', async () => {
  const siteCss = ':root{--color-link:#0b6e4f}';
  const ASSETS = {
    fetch: async (r: Request) =>
      new URL(r.url).pathname === '/styles/site.css'
        ? new Response(siteCss)
        : new Response('', { status: 404 }),
  };
  const themed = await get('/v/abc123/styles/critical.css', { ASSETS });
  assert.equal(themed.res.status, 200);
  assert.match(themed.body, /--color-link: #2448d8/, 'runtime tokens first');
  assert.ok(themed.body.endsWith(`/* site.css */\n${siteCss}`), 'site tokens last, so they win');
  assert.equal(themed.res.headers.get('content-type'), 'text/css; charset=utf-8');
  assert.equal(themed.res.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  const plain = await get('/v/abc123/styles/critical.css');
  assert.doesNotMatch(plain.body, /site\.css \*\//, 'no site.css, no change');
  // A site that ships its own critical.css gets exactly that file.
  const own = await get('/v/abc123/styles/critical.css', {
    ASSETS: {
      fetch: async (r: Request) =>
        new Response(new URL(r.url).pathname === '/styles/critical.css' ? 'mine' : siteCss),
    },
  });
  assert.equal(own.body, 'mine');
});

test('CSP nonce: each HTML response gets its own nonce on every script, a weak ETag, and 304s still work', async () => {
  const { withNonce, nonceCsp } = await import('../src/nonce.ts');
  // A minimal HTMLRewriter (workerd has the real one): records the handler and applies it to tags.
  class FakeRewriter {
    handler?: { element(el: { setAttribute(k: string, v: string): void }): void };
    on(_selector: string, handler: FakeRewriter['handler']) {
      this.handler = handler;
      return this;
    }
    transform(res: Response) {
      let nonce = '';
      this.handler?.element({ setAttribute: (_k, v) => (nonce = v) });
      if (!res.body) return res;
      const body = new ReadableStream({
        async start(controller) {
          const html = (await res.text()).replaceAll('<script', `<script nonce="${nonce}"`);
          controller.enqueue(new TextEncoder().encode(html));
          controller.close();
        },
      });
      return new Response(body, res);
    }
  }
  const g = globalThis as { HTMLRewriter?: unknown };
  g.HTMLRewriter = FakeRewriter;
  try {
    const page = () =>
      new Response('<script type="module" src="/s.js"></script>', {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          etag: '"abc"',
          'content-security-policy': "script-src 'self'",
        },
      });
    const a = withNonce(page());
    const b = withNonce(page());
    const nonceA = /'nonce-([^']+)'/.exec(a.headers.get('content-security-policy') ?? '')?.[1];
    const nonceB = /'nonce-([^']+)'/.exec(b.headers.get('content-security-policy') ?? '')?.[1];
    assert.ok(nonceA && nonceB && nonceA !== nonceB, 'a fresh nonce per response');
    assert.equal(a.headers.get('content-security-policy'), nonceCsp(nonceA));
    assert.match(a.headers.get('content-security-policy') ?? '', /'strict-dynamic'/);
    assert.equal(a.headers.get('etag'), 'W/"abc"');
    assert.equal(await a.text(), `<script nonce="${nonceA}" type="module" src="/s.js"></script>`);
    const notModified = withNonce(new Response(null, { status: 304, headers: { etag: '"abc"' } }));
    assert.equal(notModified.status, 304);
    assert.equal(notModified.headers.get('etag'), 'W/"abc"');
    const head = withNonce(
      new Response(null, { headers: { 'content-type': 'text/html', etag: '"abc"' } }),
    );
    assert.equal(head.headers.get('etag'), 'W/"abc"', 'HEAD carries the same validator as GET');
    const css = new Response('body{}', { headers: { 'content-type': 'text/css' } });
    assert.equal(withNonce(css), css, 'non-HTML passes through');
  } finally {
    delete g.HTMLRewriter;
  }
});
