import assert from 'node:assert/strict';
import { test } from 'node:test';
import { firstParagraph, renderRichText, safeHref } from '../src/render/richtext.ts';
import type { Entry, RichTextDocument } from '../src/types.ts';
import { blockCtx, doc, p, text } from './fixtures.ts';

const ctx = {
  ...blockCtx(),
  pathFor: (e: Partial<Entry> | null | undefined) => (e?.fields?.slug ? `/${e.fields.slug}` : null),
};
const render = (d: RichTextDocument | null) => renderRichText(d, ctx).value;

test('escapes text and applies marks', () => {
  const out = render(doc(p(text('<b>&', ['bold', 'italic']))));
  assert.equal(out, '<p><em><strong>&lt;b&gt;&amp;</strong></em></p>');
});

test('renders headings, lists, code and tables', () => {
  const out = render(
    doc(
      { nodeType: 'heading-2', content: [text('H')] },
      { nodeType: 'unordered-list', content: [{ nodeType: 'list-item', content: [p(text('a'))] }] },
      { nodeType: 'code-block', content: [text('x < y')] },
      {
        nodeType: 'table',
        content: [
          { nodeType: 'table-row', content: [{ nodeType: 'table-cell', content: [p(text('c'))] }] },
        ],
      },
    ),
  );
  assert.match(out, /^<h2>H<\/h2><ul><li><p>a<\/p><\/li><\/ul><pre><code>x &lt; y<\/code><\/pre>/);
  assert.match(
    out,
    /<div class="table-wrapper"><table><tr><td><p>c<\/p><\/td><\/tr><\/table><\/div>/,
  );
});

test('drops unsafe link URLs but keeps their text', () => {
  const out = render(
    doc(
      p({ nodeType: 'hyperlink', data: { uri: 'javascript:alert(1)' }, content: [text('click')] }),
    ),
  );
  assert.equal(out, '<p>click</p>');
  // Protocol-relative links are ordinary links (the CMS's own rule): they can't run script.
  assert.equal(safeHref('//cdn.example/x'), '//cdn.example/x');
  assert.equal(safeHref('java\tscript:alert(1)'), null);
  assert.equal(safeHref('javascript&colon;alert(1)'), null);
  assert.equal(safeHref('/ok'), '/ok');
  assert.equal(safeHref('https://x.example/a'), 'https://x.example/a');
});

test('entry hyperlinks resolve to routes', () => {
  const out = render(
    doc(
      p(text('See '), {
        nodeType: 'entry-hyperlink',
        data: { target: { id: 'p-about', contentType: 'page', fields: { slug: 'about' } } },
        content: [text('about')],
      }),
    ),
  );
  assert.equal(out, '<p>See <a href="/about">about</a></p>');
});

test('CTA rule: a lone bold link is a primary button, italic secondary, both accent', () => {
  const cta = (marks: string[]) =>
    render(doc(p({ nodeType: 'hyperlink', data: { uri: '/go' }, content: [text('Go', marks)] })));
  assert.equal(cta(['bold']), '<p class="cta-row"><a href="/go" class="button primary">Go</a></p>');
  assert.match(cta(['italic']), /button secondary/);
  assert.match(cta(['bold', 'italic']), /button accent/);
  // A link sharing its paragraph with text stays a link.
  assert.doesNotMatch(
    render(
      doc(
        p(text('Read '), {
          nodeType: 'hyperlink',
          data: { uri: '/go' },
          content: [text('more', ['bold'])],
        }),
      ),
    ),
    /button/,
  );
});

test('unknown nodes render their children; bad input renders nothing', () => {
  assert.equal(render(doc({ nodeType: 'mystery', content: [text('kept')] })), 'kept');
  assert.equal(render(null), '');
});

test('firstParagraph truncates on a word boundary', () => {
  const long = doc(p(text('word '.repeat(60))));
  const out = firstParagraph(long, 40);
  assert.ok(out.length <= 40 && out.endsWith('…'));
});
