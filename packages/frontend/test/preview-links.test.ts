import assert from 'node:assert/strict';
import { test } from 'node:test';
import { previewHref, stayInPreview } from '../src/preview-links.ts';
import { doc, p, text } from './fixtures.ts';
import { call, GRANT, post } from './support/preview.ts';

const SESSION = 'sess_12345678';
const options = { origins: ['https://contentworker.site'], session: SESSION };

test('same-site page links move into preview, carrying the session', () => {
  assert.equal(previewHref('/about', options), `/__preview/about?cw_session=${SESSION}`);
  assert.equal(previewHref('/', options), `/__preview/?cw_session=${SESSION}`);
  assert.equal(
    previewHref('https://contentworker.site/blog?page=2#top', options),
    `/__preview/blog?page=2&cw_session=${SESSION}#top`,
  );
  // A stale session on the link is replaced by the page's own.
  assert.equal(
    previewHref('/about?cw_session=other_1234', options),
    `/__preview/about?cw_session=${SESSION}`,
  );
});

test('everything else is left alone', () => {
  for (const href of [
    '#main',
    'mailto:hi@example.com',
    'tel:+15550100',
    'https://elsewhere.example/about',
    '//elsewhere.example/about',
    'javascript:alert(1)',
    '/__preview/exit?to=%2F',
    '/about.md',
    '/sitemap.xml',
    '/v/abc123/styles/eager.css',
    '',
  ])
    assert.equal(previewHref(href, options), null, href);
});

test('only <a href> is rewritten, re-escaped; other tags and attributes keep their bytes', () => {
  const html =
    '<link rel="stylesheet" href="/about"><a class="x" href="/about?a=1&amp;b=2">A</a><abbr title="/about">x</abbr><a href="#main">skip</a><a href="https://elsewhere.example/">out</a>';
  assert.equal(
    stayInPreview(html, options),
    `<link rel="stylesheet" href="/about"><a class="x" href="/__preview/about?a=1&amp;b=2&amp;cw_session=${SESSION}">A</a><abbr title="/about">x</abbr><a href="#main">skip</a><a href="https://elsewhere.example/">out</a>`,
  );
});

test('a live page keeps browsing inside preview', async () => {
  const { body } = await call(`/__preview/inline?cw_session=${SESSION}`, { cookie: GRANT });
  assert.match(body, new RegExp(`<a href="/__preview/docs\\?cw_session=${SESSION}">Docs</a>`));
  assert.match(body, /<a class="nav-brand" href="\/__preview\/\?cw_session=sess_12345678">/);
  assert.match(body, /href="#main"/);
  // Nothing outside preview is linked from the page's own site.
  assert.doesNotMatch(body, /<a\b[^>]*\shref="\/(?!__preview\/)[^"]*"/);
});

test('a path with no draft shows published content, the bar and the session, without the live script', async () => {
  const { res, body } = await call(`/__preview/?cw_session=${SESSION}`, { cookie: GRANT });
  assert.equal(res.status, 200);
  assert.match(body, /Content, at the edge/);
  assert.match(body, /<div class="preview-bar" role="status">Previewing a draft.<\/div>/);
  assert.match(body, new RegExp(`href="/__preview/docs\\?cw_session=${SESSION}"`));
  assert.doesNotMatch(body, /live-preview\.js|data-cw-/);
  assert.doesNotMatch(res.headers.get('content-security-policy') ?? '', /cw-preview/);
});

test('without a session, preview links stay as they were', async () => {
  const { body } = await call('/__preview/inline', { cookie: GRANT });
  assert.match(body, /<a href="\/docs">Docs<\/a>/);
  assert.match(body, /__preview\/exit/);
});

test('re-rendered blocks keep their links in the session', async () => {
  const { body } = await post(
    '/__preview/render',
    {
      entryId: 'p-inline',
      session: SESSION,
      fields: {
        sections: [
          {
            _type: 'richText',
            _key: 'k-l',
            body: doc(
              p({ nodeType: 'hyperlink', data: { uri: '/about' }, content: [text('About')] }),
            ),
          },
        ],
      },
    },
    { cookie: GRANT },
  );
  const main: string = JSON.parse(body).main;
  assert.match(main, new RegExp(`<a href="/__preview/about\\?cw_session=${SESSION}">About</a>`));
  assert.doesNotMatch(main, /<a\b[^>]*\shref="\/(?!__preview\/)[^"]*"/);
  const bad = await post(
    '/__preview/render',
    { entryId: 'p-inline', fields: {}, session: '<x>' },
    { cookie: GRANT },
  );
  assert.equal(bad.res.status, 400);
});
