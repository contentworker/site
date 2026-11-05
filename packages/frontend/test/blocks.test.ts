import assert from 'node:assert/strict';
import { test } from 'node:test';
import cards from '../public/blocks/cards/cards.render.ts';
import media from '../public/blocks/media/media.render.ts';
import type { Entry } from '../src/types.ts';
import worker, { Site } from '../src/worker.ts';
import { asset, blockCtx, env, fakeDelivery, must, world } from './fixtures.ts';

async function get(path: string) {
  const delivery = fakeDelivery();
  const e = env({ CONTENTWORKER_DELIVERY: delivery });
  const w = await world(Site, e);
  const res = await worker.fetch(new Request(`https://contentworker.site${path}`), e, w.ctx);
  const body = res.status === 200 ? await res.text() : '';
  await Promise.all(w.ctx.pending);
  return { res, body };
}

test('a page that starts with a block gets its h1 from the page title, and headings descend', async () => {
  const { body } = await get('/blocks');
  assert.equal((body.match(/<h1>/g) ?? []).length, 1);
  assert.match(
    body,
    /<main id="main"><section class="section page-head"><div class="default-content-wrapper"><h1>Blocks<\/h1>/,
  );
  const levels = [...body.matchAll(/<h([1-6])>/g)].map((m) => Number(m[1]));
  for (let i = 1; i < levels.length; i += 1)
    assert.ok((levels[i] ?? 0) <= (levels[i - 1] ?? 0) + 1, `h${levels[i - 1]} → h${levels[i]}`);
  assert.match(body, /<meta name="description" content="First card">/);
});

test('a page of blocks renders each block finished, with its CSS linked before its section', async () => {
  const { res, body } = await get('/blocks');
  assert.equal(res.status, 200);
  // Section 1's CSS is in <head>; later sections link theirs just before they start.
  assert.match(body.split('</head>')[0] ?? '', /blocks\/cards\/cards.css/);
  assert.match(
    body,
    /<link rel="stylesheet" href="\/v\/abc123\/blocks\/columns\/columns.css"><section class="section columns-container"/,
  );
  // Blocks inside a fragment get their CSS too, and the fragment's blocks render in place.
  assert.match(
    body,
    /blocks\/cta\/cta.css">.*blocks\/faq\/faq.css"><section class="section fragment-container"/s,
  );
  assert.match(
    body,
    /<div class="cta block"[^>]*><div class="cta-body"><h2>Start now<\/h2><p class="button-wrapper"><a class="button primary" href="\/docs">Get started<\/a>/,
  );
  // Every block in the starter works without JS.
  assert.doesNotMatch(
    body,
    /data-block-status="initialized"[^>]*data-block-name="(cards|columns|faq|cta|media|fragment)"/,
  );
  assert.equal((body.match(/data-block-js="0"/g) ?? []).length >= 6, true);
});

test('fragments and their contents are in the page Cache-Tag', async () => {
  const { res } = await get('/blocks');
  const tags = (res.headers.get('cache-tag') ?? '').split(',');
  for (const t of ['e:frag-1', 'e:b-cta', 'e:b-faq', 'e:a-c1', 'e:v-1'])
    assert.ok(tags.includes(t), t);
});

test('FAQ: native disclosures, plus FAQPage JSON-LD in <head>', async () => {
  const { body } = await get('/blocks');
  assert.match(
    body,
    /<details class="faq-item"><summary><h3>Is it fast\?<\/h3><\/summary><div class="faq-answer"><p>Yes, it is served from the edge.<\/p>/,
  );
  const ld = JSON.parse(
    must(/<script type="application\/ld\+json">(.*?)<\/script>/.exec(body)?.[1], 'JSON-LD'),
  );
  const faq = ld['@graph'].find((n: { '@type': string }) => n['@type'] === 'FAQPage');
  assert.deepEqual(faq.mainEntity[0], {
    '@type': 'Question',
    name: 'Is it fast?',
    acceptedAnswer: { '@type': 'Answer', text: 'Yes, it is served from the edge.' },
  });
});

test('the Markdown twin uses block Markdown (cards, FAQ inside a fragment)', async () => {
  const { body } = await get('/blocks.md');
  assert.match(body, /## Cards\n\n### One\n\nFirst card\n\n### Two\n\nSecond card/);
  assert.match(body, /## Questions\n\n### Is it fast\?\n\nYes, it is served from the edge./);
});

test('cards: one link per card, sized images, escaped text', () => {
  const ctx = blockCtx();
  const out = cards(
    {
      id: 'x',
      contentType: 'cards',
      fields: {
        items: [
          {
            title: '<One>',
            image: asset('x'),
            link: { contentType: 'page', fields: { slug: 'about' } },
          },
        ],
      },
    },
    ctx,
  ).value;
  assert.equal((out.match(/<a /g) ?? []).length, 1);
  // No section heading: card titles sit directly under the page h1.
  assert.match(out, /<h2><a href="\/about">&lt;One&gt;<\/a><\/h2>/);
  const titled = cards(
    { id: 'y', contentType: 'cards', fields: { heading: 'Picks', items: [{ title: 'A' }] } },
    { ...blockCtx(), headingLevel: 2 },
  ).value;
  assert.match(
    titled,
    /^<h2>Picks<\/h2><ul class="cards-list"><li class="card"><div class="card-body"><h3>A<\/h3>/,
  );
  assert.match(out, /sizes="\(min-width: 1200px\) 380px, \(min-width: 600px\) 50vw, 100vw"/);
});

test('media: video costs nothing until play; images are responsive', () => {
  const ctx = blockCtx();
  const video = media(
    {
      id: 'x',
      contentType: 'media',
      fields: {
        asset: {
          url: 'https://s/v.m3u8',
          kind: 'video',
          video: { hlsUrl: 'https://s/v.m3u8', thumbnailUrl: 'https://s/t.jpg' },
        },
      },
    },
    ctx,
  ).value;
  assert.match(
    video,
    /<video controls preload="none" playsinline poster="https:\/\/s\/t.jpg" width="1920" height="1080" aria-label="Video"><source src="https:\/\/s\/v.m3u8" type="application\/x-mpegURL"><a href="https:\/\/s\/v.m3u8">Download the video<\/a><\/video>/,
  );
  const img = media(
    { id: 'x', contentType: 'media', fields: { asset: asset('m'), caption: 'Cap' } },
    ctx,
  ).value;
  assert.match(img, /<figure><img src=.*srcset=.*<figcaption>Cap<\/figcaption><\/figure>/);
});

test('/blog lists articles newest first with an h1; unknown pages 404', async () => {
  const { res, body } = await get('/blog');
  assert.equal(res.status, 200);
  assert.match(body, /<title>Blog · ContentWorker<\/title>/);
  assert.match(
    body,
    /<section class="section listing-head"><div class="default-content-wrapper"><h1>Blog<\/h1>/,
  );
  assert.match(
    body,
    /<li><article><h2><a href="\/blog\/edge-rendering">Edge rendering, explained<\/a><\/h2><p class="article-list-date"><time datetime="2026-10-31T09:00:00Z">2026-10-31<\/time>/,
  );
  assert.ok((res.headers.get('cache-tag') ?? '').split(',').includes('type:article'));
  assert.equal((await get('/blog/page/5')).res.status, 404);
  const sitemap = await get('/sitemaps/article-1.xml');
  assert.match(sitemap.body, /<url><loc>https:\/\/contentworker.site\/blog<\/loc><\/url>/);
});

test('a fragment that includes itself stops instead of recursing forever', async () => {
  const fragment = (await import('../public/blocks/fragment/fragment.render.ts')).default;
  const loop: Entry = { id: 'f', contentType: 'fragment', fields: { sections: [] } };
  loop.fields.sections.push(loop);
  assert.doesNotThrow(() => fragment(loop, blockCtx()));
});

test('blocks-field sections ({ _type, _key, …fields }) render like linked block entries', async () => {
  const { res, body } = await get('/inline');
  assert.equal(res.status, 200);
  assert.match(
    body,
    /<section class="section hero-container"[^>]*><div class="hero-wrapper"><div class="hero block"[^>]*><picture><img src="https:\/\/media.example\/a-inline\/w960\/a-inline.jpg"/,
  );
  assert.match(body, /<h1>Inline hero<\/h1>/);
  assert.match(body, /<details class="faq-item"><summary><h3>Inline\?<\/h3><\/summary>/);
  assert.match(body, /"@type":"FAQPage"/);
  assert.doesNotMatch(body, /unknown variant/);
  assert.ok(
    (res.headers.get('cache-tag') ?? '').split(',').includes('e:a-inline'),
    'assets inside elements are tagged',
  );
  const md = await get('/inline.md');
  assert.match(md.body, /## Asked\n\n### Inline\?\n\nYes./);
});
