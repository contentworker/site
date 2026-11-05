import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker, { Site } from '../src/worker.ts';
import { env, fakeDelivery, world } from './fixtures.ts';

async function get(
  path: string,
  {
    fail = false,
    method = 'GET',
    headers = {},
    overrides = {},
  }: {
    fail?: boolean;
    method?: string;
    headers?: Record<string, string>;
    overrides?: Record<string, unknown>;
  } = {},
) {
  const delivery = fakeDelivery({ fail });
  const e = env({ CONTENTWORKER_DELIVERY: delivery, ...overrides });
  const w = await world(Site, e);
  const res = await worker.fetch(
    new Request(`https://contentworker.site${path}`, { method, headers }),
    e,
    w.ctx,
  );
  const body = method === 'HEAD' || res.status === 304 ? '' : await res.text();
  await Promise.all(w.ctx.pending);
  return { res, body, calls: delivery.calls, ...w };
}

test('the www host redirects before anything renders or reaches Delivery', async () => {
  const delivery = fakeDelivery({});
  const e = env({ CONTENTWORKER_DELIVERY: delivery });
  const w = await world(Site, e);
  const res = await worker.fetch(new Request('https://www.contentworker.site/blocks'), e, w.ctx);
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), 'https://contentworker.site/blocks');
  assert.equal(delivery.calls.length, 0);
});

test('home renders complete HTML: head, header, sections, footer', async () => {
  const { res, body, calls } = await get('/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/html/);
  assert.ok(body.startsWith('<!doctype html><html lang="en-US"><head>'));
  assert.match(body, /<title>Home · ContentWorker<\/title>/);
  assert.match(body, /<link rel="canonical" href="https:\/\/contentworker.site\/">/);
  assert.match(body, /<meta name="description" content="A fast starter.">/);
  assert.match(
    body,
    /<meta property="og:image" content="https:\/\/media.example\/a-hero\/r-og\/a-hero.jpg">/,
  );
  assert.match(body, /<script type="application\/ld\+json">\{"@context":"https:\/\/schema.org"/);
  assert.equal((body.match(/<h1>/g) ?? []).length, 1);
  assert.match(body.split('</head>')[0] ?? '', /href="\/v\/abc123\/blocks\/hero\/hero.css"/);
  assert.match(
    body,
    /<div class="hero block" data-block-name="hero" data-block-status="loaded" data-block-js="0">/,
  );
  assert.equal((body.match(/fetchpriority="high"/g) ?? []).length, 1);
  assert.match(
    body,
    /<p class="button-wrapper"><a href="\/docs" class="button primary">Read the getting-started guide<\/a><\/p>/,
  );
  assert.match(body, /<div class="default-content-wrapper"><h2>Why &lt;fast&gt;<\/h2>/);
  assert.match(body, /<li><a href="\/docs">Docs<\/a><\/li>/);
  assert.doesNotMatch(body, /javascript:/);
  assert.match(
    body,
    /<\/main><link rel="stylesheet" href="\/v\/abc123\/blocks\/footer\/footer.css"><footer>/,
  );
  assert.ok(body.endsWith('</footer></body></html>'));
  // Routes (once per isolate), settings and the page.
  assert.ok(calls.length <= 3);
  assert.equal(calls.filter((c) => c.url.pathname.endsWith('/entries')).length, 2);
  for (const c of calls) {
    assert.equal(c.init.headers.authorization, 'Bearer cda_test');
    assert.equal(c.url.searchParams.get('locale'), 'en-US');
  }
});

test('pages are edge-cached for a day, tagged with everything they used, revalidated by browsers', async () => {
  const { res } = await get('/');
  assert.equal(res.headers.get('cache-control'), 'public, max-age=0, must-revalidate');
  assert.equal(
    res.headers.get('cloudflare-cdn-cache-control'),
    'public, max-age=86400, stale-while-revalidate=86400, stale-if-error=604800',
  );
  const tags = (res.headers.get('cache-tag') ?? '').split(',');
  for (const t of ['site', 'e:p-home', 'e:b-hero', 'e:a-hero', 'e:a-two', 'e:settings', 'e:p-docs'])
    assert.ok(tags.includes(t), t);
  assert.match(res.headers.get('etag') ?? '', /^"[0-9a-f]{24}"$/);
  assert.match(
    res.headers.get('link') ?? '',
    /^<\/v\/abc123\/styles\/eager.css>; rel=preload; as=style, <https:\/\/media.example>; rel=preconnect$/,
  );
  assert.equal(res.headers.get('speculation-rules'), '"/v/abc123/speculation-rules.json"');
});

test('a matching If-None-Match gets a 304 with no body', async () => {
  const first = await get('/about');
  const etag = first.res.headers.get('etag') ?? '';
  const again = await get('/about', { headers: { 'if-none-match': etag } });
  assert.equal(again.res.status, 304);
  assert.equal(again.res.headers.get('etag'), etag);
});

test('the gateway hands Site a clean cache key: no query, cookies or credentials', async () => {
  const { calls, res } = await get('/about?utm_source=x&gclid=y', {
    headers: { cookie: 'a=b', authorization: 'Bearer x' },
  });
  assert.equal(res.status, 200);
  assert.ok(calls.every((c) => c.init.headers.authorization === 'Bearer cda_test'));
});

test('CSP allows only same-origin scripts, with Trusted Types; no nonce in cached HTML', async () => {
  const { res, body } = await get('/');
  const csp = res.headers.get('content-security-policy') ?? '';
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /require-trusted-types-for 'script'/);
  assert.match(csp, /trusted-types loader/);
  assert.doesNotMatch(body, /nonce/);
  assert.match(body, /<script type="module" src="\/v\/abc123\/scripts\/site.js"><\/script>/);
  assert.match(body, /<link rel="modulepreload" href="\/v\/abc123\/scripts\/lib.js">/);
  assert.ok(res.headers.get('strict-transport-security'));
});

test('unknown paths render the site 404: status 404, noindex, short edge TTL, tag notfound', async () => {
  const { res, body } = await get('/does-not-exist');
  assert.equal(res.status, 404);
  assert.match(body, /<meta name="robots" content="noindex">/);
  assert.match(body, /<h1>Page not found<\/h1>/);
  assert.doesNotMatch(body, /rel="canonical"/);
  assert.equal(res.headers.get('cloudflare-cdn-cache-control'), 'public, max-age=300');
  assert.equal(res.headers.get('cache-tag'), 'site,notfound');
});

test('non-canonical URLs 301 to the canonical one', async () => {
  for (const [from, to] of [
    ['/About/', '/about'],
    ['/home', '/'],
    ['/about.html', '/about'],
  ] as const) {
    const { res } = await get(from);
    assert.equal(res.status, 301, from);
    assert.equal(res.headers.get('location'), `https://contentworker.site${to}`);
  }
});

test('a Delivery failure is a 503 with Retry-After that is never cached', async () => {
  const { res } = await get('/', { fail: true });
  assert.equal(res.status, 503);
  assert.equal(res.headers.get('retry-after'), '30');
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
});

test('HEAD answers with headers only', async () => {
  const { res } = await get('/about', { method: 'HEAD' });
  assert.equal(res.status, 200);
  assert.equal(res.body, null);
});

test('versioned code URLs are immutable; speculation rules get their media type', async () => {
  const { res } = await get('/v/abc123/styles/eager.css');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  const old = await get('/v/oldbuild/styles/eager.css');
  assert.equal(old.res.headers.get('cache-control'), 'public, max-age=60');
  assert.equal(old.res.headers.get('cloudflare-cdn-cache-control'), 'no-store');
  const rules = await get('/v/abc123/speculation-rules.json');
  assert.equal(rules.res.headers.get('content-type'), 'application/speculationrules+json');
});

test('/health is plain ok; other methods are refused', async () => {
  assert.equal((await get('/health')).body, 'ok');
  assert.equal((await get('/', { method: 'POST' })).res.status, 405);
});

test('a misconfigured backend explains itself on localhost only', async () => {
  const e = env({ CONTENTWORKER: '' });
  const w = await world(Site, e);
  const local = await worker.fetch(new Request('http://localhost:8787/'), e, w.ctx);
  assert.equal(local.status, 500);
  assert.match(await local.text(), /^Configuration: Set CONTENTWORKER/);
  const live = await worker.fetch(new Request('https://contentworker.site/'), e, w.ctx);
  assert.equal(await live.text(), 'Site misconfigured.');
});
