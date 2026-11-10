import { html, type Safe } from '../../../src/html.ts';
import { richTextToMarkdown } from '../../../src/render/markdown.ts';
import { plain } from '../../../src/render/richtext.ts';
import type { Entry, Fields, MarkdownCtx, RenderCtx } from '../../../src/types.ts';

/**
 * FAQ: questions as native <details> disclosures (keyboard and screen-reader ready, no JS), and
 * a FAQPage in the page's JSON-LD (see `structuredData`), which answer engines quote directly.
 * Fields: heading?, items[] of { question (Symbol), answer (RichText) }.
 */
export const name = 'faq';
export const contentType = 'faq';
export const css = true;
export const js = false;

const itemsOf = (entry: Entry): Fields[] =>
  (Array.isArray(entry.fields?.items) ? entry.fields.items : [])
    .map((i: Fields) => i?.fields ?? i ?? {})
    .filter((i: Fields) => i.question && i.answer);

export default function render(entry: Entry, ctx: RenderCtx): Safe {
  const heading = entry.fields.heading;
  // The section heading sits at the current level; items one below it (or at it, with none).
  const n = Math.min(Math.max(ctx.headingLevel, 1), 5);
  const level = `h${n}`;
  const itemLevel = `h${heading ? n + 1 : Math.max(n, 2)}`;
  if (heading && n === 1) ctx.headingLevel = 2;
  return html`${heading ? ctx.raw(`<${level}${ctx.ref('heading')}>${html`${heading}`}</${level}>`) : ''}${itemsOf(
    entry,
  ).map(
    (i: Fields) =>
      html`<details class="faq-item"><summary>${ctx.raw(`<${itemLevel}>${html`${i.question}`}</${itemLevel}>`)}</summary><div class="faq-answer">${ctx.richText(i.answer)}</div></details>`,
  )}`;
}

/** JSON-LD nodes for this block, emitted server-side in <head>. */
export function structuredData(entry: Entry): Record<string, unknown>[] {
  const items = itemsOf(entry);
  if (!items.length) return [];
  return [
    {
      '@type': 'FAQPage',
      mainEntity: items.map((i: Fields) => ({
        '@type': 'Question',
        name: i.question,
        acceptedAnswer: { '@type': 'Answer', text: plain(i.answer).trim() },
      })),
    },
  ];
}

export function markdown(entry: Entry, ctx: MarkdownCtx): string {
  const out = entry.fields.heading ? [`## ${entry.fields.heading}`] : [];
  for (const i of itemsOf(entry)) out.push(`### ${i.question}`, richTextToMarkdown(i.answer, ctx));
  return out.join('\n\n');
}
