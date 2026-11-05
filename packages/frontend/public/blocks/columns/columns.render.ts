import { attrs, html, type Safe } from '../../../src/html.ts';
import type { Entry, Fields, RenderCtx } from '../../../src/types.ts';

/**
 * Columns: 2–4 side-by-side columns that stack on narrow screens. A column holding only an image
 * is styled as an image column. Fields: columns[] of { body (RichText), image }.
 */
export const name = 'columns';
export const contentType = 'columns';
export const css = true;
export const js = false;

export default function render(entry: Entry, ctx: RenderCtx): Safe {
  const cols = (Array.isArray(entry.fields.columns) ? entry.fields.columns : [])
    .slice(0, 4)
    .map((c: Fields) => c?.fields ?? c ?? {});
  const n = Math.max(1, cols.length);
  const sizes = `(min-width: 900px) ${Math.round(100 / n)}vw, 100vw`;
  return html`<div${attrs({ class: `columns-grid columns-${n}-cols` })}>${cols.map((c: Fields) => {
    const imageOnly = c.image && !c.body;
    return html`<div${attrs({ class: imageOnly ? 'columns-img-col' : null })}>${c.image ? ctx.image(c.image, { sizes }) : ''}${c.body ? ctx.richText(c.body) : ''}</div>`;
  })}</div>`;
}
