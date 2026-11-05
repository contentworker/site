import { html, type Safe } from '../../../src/html.ts';
import type { Entry, RenderCtx } from '../../../src/types.ts';

/** Hero: a headline, optional lead text and CTA, over or beside an image. No client JS. */
export const name = 'hero';
export const contentType = 'hero';
export const css = true;
export const js = false;
/** The hero's heading is the page's h1. */
export const ownsTitle = true;

/**
 * Fields: heading (Symbol), lead (RichText, optional), image (Asset link, optional).
 * @param {{ fields: Record<string, any> }} entry
 */
export default function render(entry: Entry, ctx: RenderCtx): Safe {
  const { heading, lead, image } = entry.fields;
  const Heading = ctx.headingLevel === 1 ? 'h1' : 'h2';
  ctx.headingLevel = 2;
  return html`${image ? html`<picture>${ctx.image(image, { sizes: '100vw' })}</picture>` : ''}<div class="hero-body">${ctx.raw(
    `<${Heading}>`,
  )}${heading}${ctx.raw(`</${Heading}>`)}${lead ? ctx.richText(lead) : ''}</div>`;
}
