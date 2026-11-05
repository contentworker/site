import assert from 'node:assert/strict';
import { test } from 'node:test';
import { richTextToMarkdown } from '../src/render/markdown.ts';
import { AI_CRAWLERS } from '../src/seo/robots.ts';
import worker, { Site, wantsMarkdown } from '../src/worker.ts';
import { doc, env, fakeDelivery, p, text, world } from './fixtures.ts';

async function get(
  path: string,
  {
    headers = {},
    overrides = {},
  }: { headers?: Record<string, string>; overrides?: Record<string, unknown> } = {},
) {
  const delivery = fakeDelivery();
  const e = env({ CONTENTWORKER_DELIVERY: delivery, ...overrides });
  const w = await world(Site, e);
  const res = await worker.fetch(
    new Request(`https://contentworker.site${path}`, { headers }),
    e,
    w.ctx,
  );
  const body = res.status === 200 ? await res.text() : '';
  await Promise.all(w.ctx.pending);
  return { res, body };
}

test('robots.txt allows search and names AI crawlers, with the sitemap', async () => {
  const { res, body } = await get('/robots.txt');
  assert.equal(res.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.match(body, /^User-agent: \*\nAllow: \/\nDisallow: \/__\n/);
  for (const bot of AI_CRAWLERS) assert.match(body, new RegExp(`User-agent: ${bot}\\n`));
  assert.match(body, /Sitemap: https:\/\/contentworker.site\/sitemap.xml\n$/);
  assert.match(res.headers.get('cache-tag') ?? '', /e:settings/);
});

test('sitemap index lists one file per routed type; files list indexable URLs with lastmod', async () => {
  const index = await get('/sitemap.xml');
  assert.equal(index.res.headers.get('content-type'), 'application/xml; charset=utf-8');
  assert.match(index.body, /<loc>https:\/\/contentworker.site\/sitemaps\/page-1.xml<\/loc>/);
  assert.match(index.body, /<loc>https:\/\/contentworker.site\/sitemaps\/article-1.xml<\/loc>/);
  assert.equal(index.res.headers.get('cache-tag'), 'site,type:page,type:article');

  const pages = await get('/sitemaps/page-1.xml');
  assert.match(
    pages.body,
    /<url><loc>https:\/\/contentworker.site\/<\/loc><lastmod>2026-10-30T10:00:00Z<\/lastmod><\/url>/,
  );
  assert.match(pages.body, /<loc>https:\/\/contentworker.site\/about<\/loc>/);
  assert.doesNotMatch(pages.body, /hidden/, 'noindex pages stay out');
  assert.equal(pages.res.headers.get('cache-tag'), 'site,type:page');
  assert.equal((await get('/sitemaps/person-1.xml')).res.status, 404);
});

test('llms.txt maps the site to Markdown twins', async () => {
  const { body } = await get('/llms.txt');
  assert.match(
    body,
    /^# ContentWorker\n\n> ContentWorker is a headless CMS on Cloudflare.\n\n## Pages\n\n/,
  );
  assert.match(body, /- \[Home\]\(https:\/\/contentworker.site\/index.md\): A fast starter./);
  assert.match(
    body,
    /- \[About\]\(https:\/\/contentworker.site\/about.md\): About us, in plain words./,
  );
  assert.match(
    body,
    /## Articles\n\n- \[Edge rendering, explained\]\(https:\/\/contentworker.site\/blog\/edge-rendering.md\)/,
  );
  assert.doesNotMatch(body, /Hidden/);
  assert.match(body, /\[Everything on one page\]\(https:\/\/contentworker.site\/llms-full.txt\)/);
});

test('llms-full.txt is every indexable page as Markdown', async () => {
  const { body } = await get('/llms-full.txt');
  assert.match(body, /# Home/);
  assert.match(body, /# Edge rendering, explained/);
  assert.doesNotMatch(body, /Not for crawlers/);
});

test('Markdown twins: /x.md and Accept: text/markdown, canonical to the HTML', async () => {
  const md = await get('/blog/edge-rendering.md');
  assert.equal(md.res.headers.get('content-type'), 'text/markdown; charset=utf-8');
  assert.equal(
    md.res.headers.get('link'),
    '<https://contentworker.site/blog/edge-rendering>; rel="canonical"',
  );
  assert.match(
    md.body,
    /^# Edge rendering, explained\n\n> Rendering at the edge means no origin.\n\nSource: https:\/\/contentworker.site\/blog\/edge-rendering\n\n/,
  );
  assert.match(md.body, /Rendering at the edge means \*\*no origin\*\*\./);
  assert.match(md.body, /## Why\n\n- Fast\n- Cheap/);
  assert.match(md.body, /\[About us\]\(https:\/\/contentworker.site\/about\)/);

  const home = await get('/index.md');
  assert.match(home.body, /^# Home\n\n> A fast starter./);
  assert.match(home.body, /\*\*Read the getting-started guide\*\*/);
  assert.equal((await get('/hidden.md')).res.status, 404, 'noindex pages have no twin');

  const negotiated = await get('/about', { headers: { accept: 'text/markdown, text/html;q=0.8' } });
  assert.equal(negotiated.res.headers.get('content-type'), 'text/markdown; charset=utf-8');
  assert.equal(negotiated.res.headers.get('vary'), 'Accept');
  const browser = await get('/about', {
    headers: { accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
  });
  assert.match(browser.res.headers.get('content-type') ?? '', /text\/html/);
  assert.equal(browser.res.headers.get('vary'), 'Accept');
});

test('HTML links its twin and emits breadcrumbs', async () => {
  const { body } = await get('/blog/edge-rendering');
  assert.match(
    body,
    /<link rel="alternate" type="text\/markdown" href="\/blog\/edge-rendering.md">/,
  );
  assert.match(body, /"@type":"BreadcrumbList".*"position":2,"name":"Edge rendering, explained"/);
  assert.match(body, /"@type":"Article".*"author":\{"@type":"Person","name":"Sam Rivera"\}/);
});

test('ContentWorker redirects answer for paths with no page; unsafe targets are ignored', async () => {
  const { res } = await get('/old-about');
  assert.equal(res.status, 308);
  assert.equal(res.headers.get('location'), 'https://contentworker.site/about');
  assert.equal(res.headers.get('cache-tag'), 'site,redirects,notfound');
  assert.equal((await get('/evil')).res.status, 404);
});

test('wantsMarkdown follows Accept preferences', () => {
  assert.equal(wantsMarkdown('text/markdown'), true);
  assert.equal(wantsMarkdown('text/html, text/markdown'), false);
  assert.equal(wantsMarkdown('text/html;q=0.5, text/markdown'), true);
  assert.equal(wantsMarkdown('text/markdown;q=0'), false);
  assert.equal(wantsMarkdown('*/*'), false);
  assert.equal(wantsMarkdown(null), false);
});

test('Markdown escapes text and renders tables and code', () => {
  const md = richTextToMarkdown(
    doc(
      p(text('a *b* [c]')),
      { nodeType: 'code-block', content: [text('x ``` y')] },
      {
        nodeType: 'table',
        content: [
          {
            nodeType: 'table-row',
            content: [{ nodeType: 'table-header-cell', content: [p(text('h|1'))] }],
          },
          { nodeType: 'table-row', content: [{ nodeType: 'table-cell', content: [p(text('v'))] }] },
        ],
      },
    ),
    { origin: 'https://x' },
  );
  assert.equal(md, 'a \\*b\\* \\[c\\]\n\n````\nx ``` y\n````\n\n| h\\|1 |\n| --- |\n| v |');
});
