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

test('a preview of a blocks-field page marks its slot, its blocks and its title', async () => {
  const { body } = await call('/__preview/inline', { cookie: GRANT });
  assert.match(body, /<main id="main" data-cw-slot="sections">/);
  assert.match(
    body,
    /<section class="section hero-container" data-section-status="initialized" data-cw-block="k-hero">/,
  );
  assert.match(
    body,
    /<section class="section faq-container" data-section-status="initialized" data-cw-block="k-faq">/,
  );
  // An unknown variant renders nothing, so there is nothing to mark.
  assert.doesNotMatch(body, /k-unknown/);
  // The hero owns the h1 here; the page's title has no element of its own to mark.
  assert.doesNotMatch(body, /data-cw-ref/);
});

test("a preview of a body page marks its title and body with the page entry's refs", async () => {
  const { body } = await call('/__preview/about', { cookie: 'cw_preview=p-about~pw_good' });
  assert.ok(body.includes(`data-cw-ref="${ref('p-about', 'page', 'body')}"`));
  assert.ok(
    body.includes(`<h1 data-cw-ref="${ref('p-about', 'page', 'title')}">About (draft)</h1>`),
  );
  // A body page has no blocks field.
  assert.doesNotMatch(body, /data-cw-slot|data-cw-block/);
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
    assert.doesNotMatch(html, /data-cw-|cw-admin-origin|live-preview\.js/, path);
  }
});

test('live preview loads only under /__preview, for the draft, with cw_session and a known admin', async () => {
  const live = await call('/__preview/inline?cw_session=sess_12345678', { cookie: GRANT });
  assert.match(
    live.body,
    /<meta name="cw-admin-origin" content="https:\/\/example"><script type="module" src="\/v\/abc123\/scripts\/live-preview.js"><\/script><\/head>/,
  );
  const plain = await call('/__preview/inline', { cookie: GRANT });
  assert.doesNotMatch(plain.body, /live-preview\.js|cw-admin-origin/);
  const odd = await call('/__preview/inline?cw_session=x', { cookie: GRANT });
  assert.doesNotMatch(odd.body, /live-preview\.js/);
  const notDraft = await call('/__preview/?cw_session=sess_12345678', { cookie: GRANT });
  assert.doesNotMatch(notDraft.body, /live-preview\.js/);
  const noAdmin = await call('/__preview/inline?cw_session=sess_12345678', {
    cookie: GRANT,
    env: { CONTENTWORKER: 'site/main', CONTENTWORKER_PREVIEW: 'https://preview-host.example' },
  });
  assert.doesNotMatch(noAdmin.body, /live-preview\.js/);
});

test('the live preview script ships with the runtime, served from the versioned code path', async () => {
  const { EMBEDDED } = await import('../src/assets.generated.ts');
  assert.match(EMBEDDED['/scripts/live-preview.js']?.body ?? '', /startLivePreview/);
  const { res } = await call('/v/abc123/scripts/live-preview.js', { env: { ASSETS: undefined } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /javascript/);
});
