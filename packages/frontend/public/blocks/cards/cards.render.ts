import { html, type Safe } from '../../../src/html.ts';
import { richTextToMarkdown } from '../../../src/render/markdown.ts';
import type { Entry, Fields, MarkdownCtx, RenderCtx } from '../../../src/types.ts';

/**
 * Cards: a grid of items, each an image, a title, text and an optional link (the whole card is
 * the link's hit area via CSS, with one real <a>, so screen readers hear each card once).
 * Fields: heading?, items[] of components or entries { title, body (RichText), image, link | url }.
 */
export const name = 'cards';
export const contentType = 'cards';
export const css = true;
export const js = false;

const SIZES = '(min-width: 1200px) 380px, (min-width: 600px) 50vw, 100vw';

export default function render(entry: Entry, ctx: RenderCtx): Safe {
  const { heading, items } = entry.fields;
  // The section heading sits at the current level; items one below it (or at it, with none).
  const n = Math.min(Math.max(ctx.headingLevel, 1), 5);
  const level = `h${n}`;
  const itemLevel = `h${heading ? n + 1 : Math.max(n, 2)}`;
  if (heading && n === 1) ctx.headingLevel = 2;
  const cards = (Array.isArray(items) ? items : []).map((raw: Fields) => {
    const item = raw?.fields ?? raw ?? {};
    const href = ctx.href(item.link ?? item.url);
    const title = item.title
      ? href
        ? html`<a href="${href}">${item.title}</a>`
        : html`${item.title}`
      : '';
    return html`<li class="card">${item.image ? html`<div class="card-image">${ctx.image(item.image, { sizes: SIZES })}</div>` : ''}<div class="card-body">${
      title ? ctx.raw(`<${itemLevel}>${title}</${itemLevel}>`) : ''
    }${item.body ? ctx.richText(item.body) : ''}</div></li>`;
  });
  return html`${heading ? ctx.raw(`<${level}>${html`${heading}`}</${level}>`) : ''}<ul class="cards-list">${cards}</ul>`;
}

export function markdown(entry: Entry, ctx: MarkdownCtx): string {
  const { heading, items } = entry.fields;
  const out = heading ? [`## ${heading}`] : [];
  for (const raw of Array.isArray(items) ? items : []) {
    const item = raw?.fields ?? raw ?? {};
    if (item.title) out.push(`### ${item.title}`);
    if (item.body) out.push(richTextToMarkdown(item.body, ctx));
  }
  return out.join('\n\n');
}
