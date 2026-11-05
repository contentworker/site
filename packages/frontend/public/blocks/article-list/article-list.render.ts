import { html, type Safe } from '../../../src/html.ts';
import { firstParagraph } from '../../../src/render/richtext.ts';
import type { Entry, Fields, RenderCtx } from '../../../src/types.ts';

/**
 * A listing route (/blog by default): newest entries first, with paging links. Built by the Worker from a
 * Delivery query, not authored. Fields: items[], page, pages.
 */
export const name = 'article-list';
export const contentType = 'articleList';
export const css = true;
export const js = false;

const date = (iso: string | undefined): string =>
  iso ? new Date(iso).toISOString().slice(0, 10) : '';

export default function render(entry: Entry, ctx: RenderCtx): Safe {
  const { items = [], page = 1, pages = 1, base = '/blog' } = entry.fields;
  const pageHref = (n: number): string => (n === 1 ? base : `${base}/page/${n}`);
  return html`<ol class="article-list-items">${items.map((a: Fields) => {
    const when = a.fields?.publishedAt ?? a.publishedAt;
    return html`<li><article><h2><a href="${ctx.pathFor(a)}">${a.fields?.title}</a></h2>${
      when
        ? html`<p class="article-list-date"><time datetime="${when}">${date(when)}</time></p>`
        : ''
    }<p>${a.fields?.seo?.description || firstParagraph(a.fields?.body)}</p></article></li>`;
  })}</ol>${
    pages > 1
      ? html`<nav class="article-list-pages" aria-label="Pages">${
          page > 1 ? html`<a rel="prev" href="${pageHref(page - 1)}">Newer</a>` : ''
        }<span>Page ${page} of ${pages}</span>${
          page < pages ? html`<a rel="next" href="${pageHref(page + 1)}">Older</a>` : ''
        }</nav>`
      : ''
  }`;
}
