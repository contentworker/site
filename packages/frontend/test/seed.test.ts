import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CONTENT_TYPES } from '../content-model/model.ts';
import { orderEntries, seed } from '../content-model/seed.ts';
import { starterContent } from '../content-model/starter-content.ts';
import worker, { Site } from '../src/worker.ts';
import { env, fakeDelivery, world } from './fixtures.ts';
import { starterByType } from './starter-delivered.ts';

/** A fake Management API that records calls and hands out ids. */
function fakeManagement({
  types = [] as string[],
  counts = [] as { contentType: string; total: number }[],
  relativeUploads = false,
} = {}) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  let n = 0;
  const fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    const path = url.pathname.replace('/spaces/site/environments/main', '');
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    calls.push({ method, path, body });
    if (url.host === 'upload.example' || url.pathname.startsWith('/media/'))
      return new Response(null, { status: 200 });
    if (method === 'GET' && path === '/content-types')
      return Response.json({ items: types.map((apiId) => ({ apiId })) });
    if (method === 'GET' && path === '/content-types/entry-counts')
      return Response.json({ items: counts });
    if (method === 'POST' && path === '/assets') {
      n += 1;
      return Response.json({
        asset: { id: `asset${n}` },
        upload: {
          url: relativeUploads ? `/media/site/main/${n}?sig=x` : `https://upload.example/${n}`,
          headers: { 'content-type': 'image/png' },
        },
      });
    }
    if (method === 'POST' && path === '/entries') {
      n += 1;
      return Response.json({ entry: { id: `entry${n}` }, fields: {} });
    }
    if (method === 'POST' && path === '/webhooks') return Response.json({ id: 'hook1' });
    return Response.json({});
  };
  return { fetch, calls };
}

const base = {
  api: 'https://api.example',
  space: 'site',
  environment: 'main',
  token: 'cma',
  locale: 'en-US',
  model: CONTENT_TYPES,
  content: starterContent,
  image: () => new Uint8Array([1, 2, 3]),
};

test('seeds an empty space: types, assets, entries in link order, published, plus the webhook', async () => {
  const m = fakeManagement();
  const report = await seed({
    ...base,
    fetch: m.fetch,
    webhook: { url: 'https://site.example/__cw/webhook', secret: 's', topics: ['entry.published'] },
  });
  assert.deepEqual(
    report.createdTypes,
    CONTENT_TYPES.map((t) => t.apiId),
  );
  const typePosts = m.calls.filter(
    (c) => c.method === 'POST' && c.path.startsWith('/content-types'),
  );
  assert.equal(typePosts.length, CONTENT_TYPES.length * 2, 'each type created and published');
  // Assets: uploaded to the signed URL, alt text set, published.
  assert.equal(
    m.calls.filter((c) => c.path.match(/^\/assets\/asset\d+\/published$/)).length,
    starterContent.assets.length,
  );
  assert.equal(m.calls.filter((c) => c.method === 'PATCH').length, starterContent.assets.length);
  // Entries: every value keyed by locale, links resolved to created ids, each published.
  const entryPosts = m.calls.filter((c) => c.method === 'POST' && c.path === '/entries');
  assert.equal(entryPosts.length, starterContent.entries.length);
  const settings = entryPosts.find(
    (c) => (c.body as { contentTypeApiId: string }).contentTypeApiId === 'siteSettings',
  )?.body as { fields: Record<string, Record<string, unknown>> };
  assert.equal(settings.fields.name?.['en-US'], 'ContentWorker');
  const nav = settings.fields.nav?.['en-US'] as { link?: { id: string; linkType: string } }[];
  assert.deepEqual(nav[0]?.link, { id: report.entries.blocks, linkType: 'Entry' });
  assert.equal(
    m.calls.filter((c) => /^\/entries\/entry\d+\/published$/.test(c.path)).length,
    starterContent.entries.length,
  );
  assert.equal(report.webhook, 'hook1');
  assert.ok(
    !JSON.stringify(m.calls.map((c) => c.body)).includes('$entry'),
    'no unresolved references sent',
  );
});

test('a space that already has content gets no starter content (re-runs are safe)', async () => {
  const m = fakeManagement({ types: ['page'], counts: [{ contentType: 'page', total: 3 }] });
  const report = await seed({ ...base, fetch: m.fetch });
  assert.ok(report.skippedTypes.includes('page'));
  assert.match(report.skippedContent ?? '', /3 page/);
  assert.equal(m.calls.filter((c) => c.path === '/entries').length, 0);
});

test('--dry-run reads and writes nothing', async () => {
  const m = fakeManagement();
  const lines: string[] = [];
  await seed({ ...base, fetch: m.fetch, dryRun: true, log: (l) => lines.push(l) });
  assert.deepEqual([...new Set(m.calls.map((c) => c.method))], ['GET']);
  assert.ok(lines.some((l) => l.startsWith('entry home (page): would create')));
});

test('entries are ordered after what they link to; cycles and dangling links are refused', () => {
  const order = orderEntries(starterContent.entries).map((e) => e.key);
  const before = (a: string, b: string) =>
    assert.ok(order.indexOf(a) < order.indexOf(b), `${a} before ${b}`);
  before('integrate', 'signup');
  before('signup', 'home');
  before('blocks', 'settings');
  before('team', 'edge-article');
  assert.throws(
    () =>
      orderEntries([
        { key: 'a', contentType: 'x', fields: { l: { $entry: 'b' } } },
        { key: 'b', contentType: 'x', fields: { l: { $entry: 'a' } } },
      ]),
    /cycle/,
  );
  assert.throws(
    () => orderEntries([{ key: 'a', contentType: 'x', fields: { l: { $entry: 'zz' } } }]),
    /unknown entry/,
  );
});

test('every starter page renders: one h1, a description, headings in order, no broken links', async () => {
  const extra = starterByType();
  const delivery = fakeDelivery({ extra });
  const e = env({ CONTENTWORKER_DELIVERY: delivery });
  for (const path of [
    '/',
    '/blocks',
    '/integrate',
    '/blog',
    '/blog/why-pages-render-at-the-edge',
    '/blog/readable-by-people-and-agents',
  ]) {
    const w = await world(Site, e);
    const res = await worker.fetch(new Request(`https://contentworker.site${path}`), e, w.ctx);
    const body = await res.text();
    await Promise.all(w.ctx.pending);
    assert.equal(res.status, 200, path);
    assert.equal((body.match(/<h1>/g) ?? []).length, 1, `${path}: one h1`);
    assert.match(body, /<meta name="description" content="[^"]{20,}">/, `${path}: description`);
    const levels = [...body.matchAll(/<h([1-6])>/g)].map((m) => Number(m[1]));
    for (let i = 1; i < levels.length; i += 1)
      assert.ok(
        (levels[i] ?? 0) <= (levels[i - 1] ?? 0) + 1,
        `${path}: h${levels[i - 1]} → h${levels[i]}`,
      );
    for (const [, href] of body.matchAll(/<a href="(\/[^"]*)"/g)) {
      assert.ok(
        href && (/^\/(blocks|integrate|blog(\/[a-z0-9-]+)?)?$/.test(href) || href === '/'),
        `${path}: link ${href}`,
      );
    }
  }
});

test('a signed upload URL relative to the API (a local stack answers one) resolves against it', async () => {
  const m = fakeManagement({ relativeUploads: true });
  await seed({ ...base, fetch: m.fetch });
  const puts = m.calls.filter((c) => c.method === 'PUT');
  assert.ok(puts.length > 0);
  for (const put of puts) assert.match(put.path, /^\/media\/site\/main\/\d+$/);
});
