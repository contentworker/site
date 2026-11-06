import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TOPICS, tagsForEvent } from '../src/webhook.ts';
import worker, { Site } from '../src/worker.ts';
import { env, fakeDelivery, world } from './fixtures.ts';

const main = {
  handle: 'main',
  items: [
    { id: 'a', label: 'About', url: '/about', children: [] },
    {
      id: 'b',
      label: 'Docs',
      url: '/docs',
      children: [
        {
          id: 'c',
          label: 'Status',
          url: 'https://status.example.com',
          target: '_blank',
          children: [],
        },
      ],
    },
    {
      id: 't',
      label: 'A tag',
      url: null,
      children: [{ id: 'u', label: 'Kept', url: '/kept', children: [] }],
    },
    { id: 'x', label: 'Bad', url: 'javascript:alert(1)', children: [] },
  ],
};
const footer = {
  handle: 'footer',
  items: [{ id: 'p', label: 'Privacy', url: '/privacy', children: [] }],
};

async function page(
  path: string,
  menus: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  const delivery = fakeDelivery({ menus });
  const e = env({ CONTENTWORKER_DELIVERY: delivery });
  const w = await world(Site, e);
  const res = await worker.fetch(
    new Request(`https://contentworker.site${path}`, { headers }),
    e,
    w.ctx,
  );
  const body = res.status === 304 ? '' : await res.text();
  await Promise.all(w.ctx.pending);
  return { res, body };
}

test('the main menu replaces siteSettings.nav in the header, nested and safe', async () => {
  const { body } = await page('/about', { main });
  const nav = body.slice(body.indexOf('id="nav-sections"'), body.indexOf('</nav>'));
  assert.match(nav, /<li><a href="\/about" aria-current="page">About<\/a><\/li>/);
  assert.match(nav, /<a href="\/docs">Docs<\/a><ul class="nav-sub">/);
  assert.match(nav, /href="https:\/\/status.example.com" target="_blank" rel="noopener"/);
  assert.match(nav, /<a href="\/kept">Kept<\/a>/, 'an item with no URL gives way to its children');
  assert.ok(!nav.includes('A tag'));
  assert.ok(!nav.includes('javascript:'), 'an unsafe URL is dropped');
});

test('with no menu, the header falls back to siteSettings.nav and pages carry no menu tag', async () => {
  const { res, body } = await page('/', {});
  assert.match(body, /id="nav-sections"><li><a/);
  assert.ok(!body.includes('nav-sub'));
  assert.ok(!(res.headers.get('cache-tag') ?? '').split(',').includes('menu'));
});

test('the footer menu renders in its own landmark', async () => {
  const { body } = await page('/', { footer });
  assert.match(
    body,
    /<nav aria-label="Footer"><ul class="footer-menu"><li><a href="\/privacy">Privacy<\/a>/,
  );
});

test('pages showing a menu are tagged, and a menu change revalidates', async () => {
  const first = await page('/', { main });
  assert.ok((first.res.headers.get('cache-tag') ?? '').split(',').includes('menu'));
  const etag = first.res.headers.get('etag') ?? '';
  const same = await page('/', { main }, { 'if-none-match': etag });
  assert.equal(same.res.status, 304);
  const renamed = { ...main, items: [{ ...main.items[0], label: 'About us' }] };
  const changed = await page('/', { main: renamed }, { 'if-none-match': etag });
  assert.equal(changed.res.status, 200, 'a renamed item must not answer 304');
});

test('menu saves and entry publishes purge the menu tag; the webhook subscribes to them', () => {
  assert.deepEqual(tagsForEvent({ type: 'menus.changed' }), ['menu']);
  assert.ok(tagsForEvent({ type: 'entry.published', entryId: 'e1' }).includes('menu'));
  assert.ok(tagsForEvent({ type: 'entry.unpublished', entryId: 'e1' }).includes('menu'));
  assert.ok(TOPICS.includes('menus.changed'));
});
