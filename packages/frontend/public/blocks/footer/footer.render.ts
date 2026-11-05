import { html, type Safe } from '../../../src/html.ts';
import type { Entry, RenderCtx } from '../../../src/types.ts';

/** Site footer from siteSettings.footer (RichText). Styles load just before it, in the body. */
export const name = 'footer';
export const contentType = null;
export const css = true;
export const js = false;

export default function render(settings: Entry | null, ctx: RenderCtx): Safe {
  const f = settings?.fields ?? {};
  return html`<div class="footer-body">${f.footer ? ctx.richText(f.footer) : ''}<p class="footer-legal">© ${ctx.year} ${f.name ?? ''}</p></div>`;
}
