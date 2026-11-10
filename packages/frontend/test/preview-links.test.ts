import assert from 'node:assert/strict';
import { test } from 'node:test';
import { previewHref, stayInPreview } from '../src/preview-links.ts';
import { doc, p, text } from './fixtures.ts';
import { call, GRANT, post } from './support/preview.ts';

const options = { origins: ['https://contentworker.site'] };
const OUTSIDE = /<a\b[^>]*\shref="\/(?!__preview\/)[^"]*"/;

test('same-site page links move under /__preview', () => {
  assert.equal(previewHref('/about', options), '/__preview/about');
  assert.equal(previewHref('/', options), '/__preview/');
  assert.equal(
    previewHref('https://contentworker.site/blog?page=2#top', options),
    '/__preview/blog?page=2#top',
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
    '/v/abc123/styles/critical.css',
    '',
  ])
    assert.equal(previewHref(href, options), null, href);
});

test('only <a href> is rewritten, re-escaped; other tags and attributes keep their bytes', () => {
  const html =
    '<link rel="stylesheet" href="/about"><a class="x" href="/about?a=1&amp;b=2">A</a><abbr title="/about">x</abbr><a href="#main">skip</a><a href="https://elsewhere.example/">out</a>';
  assert.equal(
    stayInPreview(html, options),
    '<link rel="stylesheet" href="/about"><a class="x" href="/__preview/about?a=1&amp;b=2">A</a><abbr title="/about">x</abbr><a href="#main">skip</a><a href="https://elsewhere.example/">out</a>',
  );
});

test('a draft page keeps browsing inside preview', async () => {
  const { body } = await call('/__preview/inline', { cookie: GRANT });
  assert.match(body, /<a href="\/__preview\/docs">Docs<\/a>/);
  assert.match(body, /<a class="nav-brand" href="\/__preview\/">/);
  assert.match(body, /href="#main"/);
  assert.doesNotMatch(body, OUTSIDE);
});

test('a path with no draft shows published content and the bar, links kept in preview, no live script', async () => {
  const { res, body } = await call('/__preview/', { cookie: GRANT });
  assert.equal(res.status, 200);
  assert.match(body, /Content, at the edge/);
  assert.match(body, /class="preview-bar"/);
  assert.match(body, /href="\/__preview\/docs"/);
  assert.doesNotMatch(body, OUTSIDE);
  assert.doesNotMatch(body, /live-preview\.js|data-cw-/);
});

test('re-rendered blocks keep their links in preview', async () => {
  const { body } = await post(
    '/__preview/render',
    {
      entryId: 'p-inline',
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
  assert.match(main, /<a href="\/__preview\/about">About<\/a>/);
  assert.doesNotMatch(main, OUTSIDE);
});
