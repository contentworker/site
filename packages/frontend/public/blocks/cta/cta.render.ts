import { html, type Safe } from '../../../src/html.ts';
import type { Entry, RenderCtx } from '../../../src/types.ts';

/**
 * Call to action: a heading, short text and one button. Fields: heading, body (RichText),
 * label, link (entry) | url, variant ("primary" | "secondary" | "accent").
 */
export const name = 'cta';
export const contentType = 'cta';
export const css = true;
export const js = false;

const VARIANTS = new Set(['primary', 'secondary', 'accent']);

export default function render(entry: Entry, ctx: RenderCtx): Safe {
  const { heading, body, label, link, url, variant } = entry.fields;
  const href = ctx.href(link ?? url);
  const v = VARIANTS.has(variant) ? variant : 'accent';
  ctx.headingLevel = 2;
  return html`<div class="cta-body">${heading ? html`<h2${ctx.ref('heading')}>${heading}</h2>` : ''}${body ? ctx.richText(body) : ''}${
    href && label
      ? html`<p class="cta-row"><a class="button ${v}" href="${href}">${label}</a></p>`
      : ''
  }</div>`;
}
