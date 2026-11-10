import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatContentRef, formatFieldPath } from '../src/content-ref.ts';
import { overlay } from '../src/preview-render.ts';
import { drafts, GRANT, post } from './support/preview.ts';

const RENDER = '/__preview/render';
/** A block's ref, as the page marks it. */
const blockRef = (key: string, entryId = 'p-inline') =>
  formatContentRef({
    space: 'site',
    environment: 'main',
    entryId,
    contentType: 'page',
    field: formatFieldPath({ field: 'sections', steps: [{ key }] }),
    locale: 'en-US',
  });
const inline = drafts['p-inline'];
assert.ok(inline);
const sections = inline.fields.sections as Record<string, unknown>[];
const edited = (heading: string) =>
  sections.map((s) => (s._key === 'k-hero' ? { ...s, heading } : s));

const faqEdited = (heading: string) =>
  sections.map((s) => (s._key === 'k-faq' ? { ...s, heading } : s));

test('re-renders the requested blocks from unsaved fields, escaped like any page', async () => {
  const { res, body, previewCalls } = await post(
    RENDER,
    {
      entryId: 'p-inline',
      fields: { sections: faqEdited('Edited <b>"bold"</b>') },
      refs: [blockRef('k-faq')],
    },
    { cookie: GRANT },
  );
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /^application\/json/);
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  assert.equal(res.headers.get('x-robots-tag'), 'noindex');
  assert.equal(res.headers.get('cache-tag'), null);
  const out = JSON.parse(body);
  assert.equal(out.main, undefined);
  assert.equal(out.blocks.length, 1);
  assert.equal(out.blocks[0].key, 'k-faq');
  assert.equal(out.blocks[0].ref, blockRef('k-faq'));
  const html: string = out.blocks[0].html;
  assert.match(
    html,
    new RegExp(
      `^<section class="section faq-container" data-section-status="initialized" data-cw-ref="${blockRef('k-faq').replace(/[|[\]%]/g, '\\$&')}">`,
    ),
  );
  assert.match(html, /Edited &lt;b&gt;&quot;bold&quot;&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>/);
  assert.deepEqual(out.css, ['/v/abc123/blocks/faq/faq.css']);
  // The grant is checked against the Preview API on every call.
  assert.equal(previewCalls.length, 1);
});

test('answers all of <main> when a block swap could leave the page wrong', async () => {
  const keysFor = async (keys: string[], fields: Record<string, unknown> = {}) =>
    JSON.parse(
      (
        await post(
          RENDER,
          { entryId: 'p-inline', fields, refs: keys.map((k) => blockRef(k)) },
          { cookie: GRANT },
        )
      ).body,
    );
  // The first section decides the h1 and the heading levels after it.
  assert.match((await keysFor(['k-hero'], { sections: edited('New') })).main, /New/);
  // A key the fields no longer render (removed, or not on the page yet).
  assert.ok((await keysFor(['k-gone'])).main);
  // A key on two blocks: the server can't know which one the page means.
  const twice = [...sections, { ...sections[1] }];
  assert.ok((await keysFor(['k-faq'], { sections: twice })).main);
  // A block that renders to nothing answers empty markup, so the page removes it.
  const gone = sections.map((s) => (s._key === 'k-faq' ? { ...s, _type: 'nope' } : s));
  assert.deepEqual((await keysFor(['k-faq'], { sections: gone })).blocks, [
    { ref: blockRef('k-faq'), key: 'k-faq', html: '' },
  ]);
});

test("the first block's heading changing keeps exactly one h1", async () => {
  const rt = drafts['p-rt'];
  assert.ok(rt);
  const rtSections = rt.fields.sections as Record<string, unknown>[];
  const withHeading = (heading: string) =>
    rtSections.map((s) => (s._key === 'k-rt' ? { ...s, heading } : s));
  const render = async (heading: string) => {
    const { body } = await post(
      RENDER,
      {
        entryId: 'p-rt',
        fields: { sections: withHeading(heading) },
        refs: [blockRef('k-rt', 'p-rt')],
      },
      { cookie: 'cw_preview=p-rt~pw_good' },
    );
    return JSON.parse(body).main as string;
  };
  const cleared = await render('');
  assert.equal((cleared.match(/<h1/g) ?? []).length, 1);
  assert.match(cleared, /class="section page-head"[\s\S]*<h1[^>]*>Rich \(draft\)<\/h1>/);
  const added = await render('Fresh heading');
  assert.equal((added.match(/<h1/g) ?? []).length, 1);
  assert.doesNotMatch(added, /page-head/);
  assert.match(added, /<h1[^>]*>Fresh heading<\/h1>/);
});

test("takes one locale's values (onState's), resolving links the draft embeds", async () => {
  const hero = {
    ...sections[0],
    heading: 'Localized',
    image: { id: 'a-inline', linkType: 'Asset' },
  };
  const { body } = await post(
    RENDER,
    {
      entryId: 'p-inline',
      locale: 'en-US',
      fields: { sections: [hero] },
    },
    { cookie: GRANT },
  );
  const html: string = JSON.parse(body).main;
  assert.match(html, /Localized/);
  assert.match(html, /<img[^>]+a-inline/);
});

test("a locale other than the site's is refused", async () => {
  const { res } = await post(
    RENDER,
    { entryId: 'p-inline', locale: 'de-DE', fields: { title: 'Nur Deutsch' } },
    { cookie: GRANT },
  );
  assert.equal(res.status, 422);
});

test('with several grants, the one for the requested entry is used', async () => {
  const { res } = await post(
    RENDER,
    { entryId: 'p-inline', fields: {} },
    { cookie: 'cw_preview=p-about~pw_good; cw_preview=p-inline~pw_good' },
  );
  assert.equal(res.status, 200);
});

test('without refs, answers all of <main> and every stylesheet it needs', async () => {
  const { body } = await post(RENDER, { entryId: 'p-inline', fields: {} }, { cookie: GRANT });
  const out = JSON.parse(body);
  assert.ok(out.main.includes(`data-cw-ref="${blockRef('k-hero')}"`));
  assert.ok(out.main.includes(`data-cw-ref="${blockRef('k-faq')}"`));
  assert.deepEqual(out.css, ['/v/abc123/blocks/hero/hero.css', '/v/abc123/blocks/faq/faq.css']);
});

test("only for the entry in this browser's preview grant", async () => {
  const body = { entryId: 'p-inline', fields: {} };
  assert.equal((await post(RENDER, body)).res.status, 403, 'no cookie');
  assert.equal(
    (await post(RENDER, body, { cookie: 'cw_preview=p-about~pw_good' })).res.status,
    403,
    'a grant for another entry',
  );
  assert.equal(
    (await post(RENDER, body, { cookie: 'cw_preview=p-inline~pw_bad' })).res.status,
    403,
    'an expired token',
  );
});

test('same-origin JSON only, bounded in size and shape', async () => {
  const ok = { entryId: 'p-inline', fields: {} };
  const status = async (json: unknown, headers: Record<string, string> = {}) =>
    (await post(RENDER, json, { cookie: GRANT, headers })).res.status;
  assert.equal(await status(ok, { origin: 'https://example' }), 403, 'not even the admin');
  assert.equal(await status(ok, { origin: 'https://evil.example' }), 403);
  assert.equal(await status(ok, { 'content-type': 'text/plain' }), 415);
  assert.equal(await status({ ...ok, pad: 'x'.repeat(2 * 1024 * 1024) }), 413);
  assert.equal(await status({ entryId: 'p-inline' }), 400);
  assert.equal(await status({ ...ok, refs: blockRef('k-hero') }), 400);
  assert.equal(await status({ ...ok, refs: Array(501).fill(blockRef('k-faq')) }), 400);
  assert.equal(await status({ ...ok, locale: '__proto__' }), 422);
  // A ref must name one of this entry's blocks: not a field, another entry or another locale.
  for (const bad of [
    'k-faq',
    blockRef('k-faq', 'p-about'),
    formatContentRef({
      space: 'site',
      environment: 'main',
      entryId: 'p-inline',
      contentType: 'page',
      field: 'title',
      locale: 'en-US',
    }),
    formatContentRef({
      space: 'site',
      environment: 'main',
      entryId: 'p-inline',
      contentType: 'page',
      field: 'sections[k-faq].heading',
      locale: 'en-US',
    }),
    formatContentRef({
      space: 'site',
      environment: 'main',
      entryId: 'p-inline',
      contentType: 'page',
      field: 'sections[k-faq]',
      locale: 'de-DE',
    }),
    formatContentRef({
      space: 'other',
      environment: 'main',
      entryId: 'p-inline',
      contentType: 'page',
      field: 'sections[k-faq]',
      locale: 'en-US',
    }),
  ])
    assert.equal(await status({ ...ok, refs: [bad] }), 400, bad);
  let deep: unknown = 'x';
  for (let i = 0; i < 80; i += 1) deep = [deep];
  assert.equal(await status({ ...ok, fields: { title: deep } }), 413);
});

test('supplied fields are copied, prototype names dropped', () => {
  const fields = JSON.parse('{"__proto__":{"polluted":1},"title":{"constructor":{"x":1},"a":1}}');
  const entry = overlay(inline, fields);
  assert.equal(({} as { polluted?: number }).polluted, undefined);
  assert.equal(Object.getPrototypeOf(entry.fields), Object.prototype);
  assert.deepEqual(entry.fields.title, { a: 1 });
  assert.notEqual(entry.fields.title, fields.title);
  // A link the draft doesn't embed stays a stub (renders as nothing).
  assert.deepEqual(overlay(inline, { image: { id: 'nope', linkType: 'Asset' } }).fields.image, {
    id: 'nope',
    linkType: 'Asset',
  });
});

test('a link resolves to the shallowest copy the draft embeds', () => {
  const full = { id: 'e-x', contentType: 'cta', fields: { heading: 'Full', more: 'yes' } };
  const shallowLater = {
    ...inline,
    fields: {
      // A deeper, less resolved copy comes first in document order.
      deep: [{ nested: { again: { id: 'e-x', contentType: 'cta', fields: { heading: 'Deep' } } } }],
      link: full,
    },
  };
  const entry = overlay(shallowLater, { pick: { id: 'e-x', linkType: 'Entry' } });
  assert.equal(entry.fields.pick, full);
});

test('a few bytes of links to an embedded entry cannot make the render explode', async () => {
  // The draft embeds an entry once; the request links to it twenty thousand times.
  const big = {
    id: 'e-big',
    contentType: 'cta',
    fields: {
      heading: 'Big',
      body: {
        nodeType: 'document',
        content: Array(60).fill({
          nodeType: 'paragraph',
          content: [{ nodeType: 'text', value: 'x'.repeat(20), marks: [] }],
        }),
      },
    },
  };
  const withEmbed = { ...inline, fields: { ...inline.fields, embed: big } };
  const many = { sections: Array(20_000).fill({ id: 'e-big', linkType: 'Entry' }) };
  assert.throws(() => overlay(withEmbed, many), /too large/);
  // A handful is fine.
  assert.equal(
    (
      overlay(withEmbed, { sections: Array(3).fill({ id: 'e-big', linkType: 'Entry' }) }).fields
        .sections as unknown[]
    ).length,
    3,
  );
});
