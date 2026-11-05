import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker, { Site } from '../src/worker.ts';
import { about, doc, env, fakeDelivery, p, text, world } from './fixtures.ts';

const draft = {
  ...about,
  fields: { ...about.fields, title: 'About (draft)', body: doc(p(text('Unpublished words.'))) },
};

/** Preview API at api.example; Delivery over the fake binding. */
async function get(path: string, { cookie }: { cookie?: string } = {}) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.host !== 'api.example') return realFetch(input);
    const ok =
      url.pathname.endsWith('/entries/p-about') &&
      url.searchParams.get('preview_token') === 'pw_good';
    return ok ? Response.json(draft) : new Response('no', { status: 403 });
  };
  try {
    const delivery = fakeDelivery();
    const e = env({
      CONTENTWORKER: 'https://cdn.example/site/main',
      CONTENTWORKER_DELIVERY: delivery,
    });
    const w = await world(Site, e);
    const res = await worker.fetch(
      new Request(`https://contentworker.site${path}`, { headers: cookie ? { cookie } : {} }),
      e,
      w.ctx,
    );
    const body = res.status === 200 ? await res.text() : '';
    await Promise.all(w.ctx.pending);
    return { res, body };
  } finally {
    globalThis.fetch = realFetch;
  }
}

test('a valid preview link sets a scoped cookie and redirects to the draft path', async () => {
  const { res } = await get('/__preview?entry=p-about&token=pw_good');
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/__preview/about');
  const cookie = res.headers.get('set-cookie') ?? '';
  assert.match(
    cookie,
    /^cw_preview=p-about~pw_good; Path=\/__preview; HttpOnly; Secure; SameSite=Lax; Max-Age=3600$/,
  );
});

test('an invalid or expired token is refused', async () => {
  assert.equal((await get('/__preview?entry=p-about&token=pw_bad')).res.status, 403);
  assert.equal((await get('/__preview?entry=p-about')).res.status, 400);
});

test('the draft renders under /__preview, uncached and noindex', async () => {
  const { res, body } = await get('/__preview/about', { cookie: 'cw_preview=p-about~pw_good' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  assert.equal(res.headers.get('cache-tag'), null);
  assert.match(body, /<h1>About \(draft\)<\/h1><p>Unpublished words.<\/p>/);
  assert.match(body, /<meta name="robots" content="noindex">/);
  assert.doesNotMatch(body, /rel="canonical"/);
  assert.match(body, /class="preview-bar".*href="\/__preview\/exit\?to=%2Fabout"/);
});

test('other paths under /__preview show published content; exit clears the cookie', async () => {
  const { body } = await get('/__preview/', { cookie: 'cw_preview=p-about~pw_good' });
  assert.match(body, /Content, at the edge/);
  const exit = await get('/__preview/exit?to=/about');
  assert.equal(exit.res.headers.get('location'), '/about');
  assert.match(exit.res.headers.get('set-cookie') ?? '', /Max-Age=0/);
  assert.equal((await get('/__preview/exit?to=//evil.example')).res.headers.get('location'), '/');
});
