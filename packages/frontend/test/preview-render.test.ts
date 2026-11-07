import assert from 'node:assert/strict';
import { test } from 'node:test';
import { overlay } from '../src/preview-render.ts';
import { drafts, GRANT, post } from './support/preview.ts';

const RENDER = '/__preview/render';
const inline = drafts['p-inline'];
assert.ok(inline);
const sections = inline.fields.sections as Record<string, unknown>[];
const edited = (heading: string) =>
  sections.map((s) => (s._key === 'k-hero' ? { ...s, heading } : s));

test('re-renders the requested blocks from unsaved fields, escaped like any page', async () => {
  const { res, body, previewCalls } = await post(
    RENDER,
    {
      entryId: 'p-inline',
      fields: { sections: edited('Edited <b>"bold"</b>') },
      keys: ['k-hero', 'k-gone'],
    },
    { cookie: GRANT },
  );
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /^application\/json/);
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  assert.equal(res.headers.get('x-robots-tag'), 'noindex');
  assert.equal(res.headers.get('cache-tag'), null);
  const out = JSON.parse(body);
  assert.equal(out.blocks.length, 1);
  assert.equal(out.blocks[0].key, 'k-hero');
  const html: string = out.blocks[0].html;
  assert.match(
    html,
    /^<section class="section hero-container" data-section-status="initialized" data-cw-block="k-hero">/,
  );
  assert.match(html, /Edited &lt;b&gt;&quot;bold&quot;&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>/);
  assert.deepEqual(out.missing, ['k-gone']);
  assert.deepEqual(out.css, ['/v/abc123/blocks/hero/hero.css']);
  // The grant is checked against the Preview API on every call.
  assert.equal(previewCalls.length, 1);
});

test("takes locale-keyed fields (the live preview protocol's), resolving links the draft embeds", async () => {
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
      fields: { sections: { 'en-US': [hero], 'de-DE': [] }, title: { 'de-DE': 'Nur Deutsch' } },
      keys: ['k-hero'],
    },
    { cookie: GRANT },
  );
  const html: string = JSON.parse(body).blocks[0].html;
  assert.match(html, /Localized/);
  assert.match(html, /<img[^>]+a-inline/);
});

test('without keys, answers all of <main> and every stylesheet it needs', async () => {
  const { body } = await post(RENDER, { entryId: 'p-inline', fields: {} }, { cookie: GRANT });
  const out = JSON.parse(body);
  assert.match(out.main, /data-cw-block="k-hero"/);
  assert.match(out.main, /data-cw-block="k-faq"/);
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
  assert.equal(await status({ ...ok, keys: 'k-hero' }), 400);
  assert.equal(await status({ ...ok, keys: Array(501).fill('k') }), 400);
  assert.equal(await status({ ...ok, locale: '__proto__' }), 400);
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
