import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatContentRef } from '../src/content-ref.ts';
import { call, GRANT } from './support/preview.ts';

const ref = (entryId: string, contentType: string, field: string) =>
  formatContentRef({
    space: 'site',
    environment: 'main',
    entryId,
    contentType,
    field,
    locale: 'en-US',
  });
const attr = (entryId: string, field: string) => `data-cw-ref="${ref(entryId, 'page', field)}"`;

test('a preview of a blocks-field page marks its slot, its blocks and their fields by ref path', async () => {
  const { body } = await call('/__preview/inline', { cookie: GRANT });
  assert.ok(
    body.includes(`<main id="main" data-cw-slot="${ref('p-inline', 'page', 'sections')}">`),
  );
  assert.ok(
    body.includes(
      `<section class="section with-hero" data-section-state="pending" ${attr('p-inline', 'sections[k-hero]')}>`,
    ),
  );
  assert.ok(body.includes(`<h1 ${attr('p-inline', 'sections[k-hero].heading')}>Inline hero</h1>`));
  assert.ok(
    body.includes(
      `<section class="section with-faq" data-section-state="pending" ${attr('p-inline', 'sections[k-faq]')}>`,
    ),
  );
  assert.ok(body.includes(`<h2 ${attr('p-inline', 'sections[k-faq].heading')}>Asked</h2>`));
  // The spec marks blocks by ref; there is no separate block attribute.
  assert.doesNotMatch(body, /data-cw-block/);
  assert.doesNotMatch(body, /k-unknown/);
});

test('a key holding [, ] or % is escaped in its ref path', async () => {
  const { body } = await call('/__preview/odd', { cookie: 'cw_preview=p-odd~pw_good' });
  assert.ok(body.includes(attr('p-odd', 'sections[a%5Bb%5D%25]')));
  assert.ok(body.includes(attr('p-odd', 'sections[a%5Bb%5D%25].heading')));
});

test("a preview of a body page marks its title and body with the page entry's refs", async () => {
  const { body } = await call('/__preview/about', { cookie: 'cw_preview=p-about~pw_good' });
  assert.ok(body.includes(attr('p-about', 'body')));
  assert.ok(body.includes(`<h1 ${attr('p-about', 'title')}>About (draft)</h1>`));
  assert.doesNotMatch(body, /data-cw-slot/);
});

test('published content under /__preview (not the draft) carries no marks', async () => {
  const { body } = await call('/__preview/inline', { cookie: 'cw_preview=p-about~pw_good' });
  assert.match(body, /Inline hero/);
  assert.doesNotMatch(body, /data-cw-/);
});

test('public pages carry none of the preview marks, scripts or meta', async () => {
  for (const path of ['/', '/about', '/blocks', '/inline', '/blog', '/missing']) {
    const { res, body } = await call(path, { cookie: GRANT });
    const html = body || (await res.text());
    assert.ok(html.length > 0, path);
    assert.doesNotMatch(html, /data-cw-|cw-admin-origin|cw-entry|live-preview\.js/, path);
  }
});

test('the live preview script loads on /__preview pages showing the draft, with a known admin', async () => {
  const live = await call('/__preview/inline', { cookie: GRANT });
  assert.match(
    live.body,
    /<meta name="cw-admin-origin" content="https:\/\/example"><meta name="cw-entry" content="p-inline" data-content-type="page" data-locale="en-US"><script type="module" src="\/v\/abc123\/scripts\/live-preview.js"><\/script><\/head>/,
  );
  const notDraft = await call('/__preview/', { cookie: GRANT });
  assert.doesNotMatch(notDraft.body, /live-preview\.js/);
  const noAdmin = await call('/__preview/inline', {
    cookie: GRANT,
    env: { CONTENTWORKER: 'site/main', CONTENTWORKER_PREVIEW: 'https://preview-host.example' },
  });
  assert.doesNotMatch(noAdmin.body, /live-preview\.js/);
});

test('the live preview script and its styles ship with the runtime', async () => {
  const { EMBEDDED } = await import('../src/assets.generated.ts');
  assert.match(EMBEDDED['/scripts/live-preview.js']?.body ?? '', /connectPreview/);
  assert.match(EMBEDDED['/styles/preview.css']?.body ?? '', /data-cw-ghost/);
  const { res } = await call('/v/abc123/scripts/live-preview.js', { env: { ASSETS: undefined } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /javascript/);
});
