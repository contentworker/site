import { html, type Safe } from '../../../src/html.ts';
import { menuItems } from '../../../src/render/menu.ts';
import type { Entry, RenderCtx } from '../../../src/types.ts';

/** Site footer: the `footer` menu, then siteSettings.footer (RichText). Styles load just before it, in the body. */
export const name = 'footer';
export const contentType = null;
export const css = true;
export const js = false;

export default function render(settings: Entry | null, ctx: RenderCtx): Safe {
  const f = settings?.fields ?? {};
  const menu = ctx.menus.footer?.items ?? [];
  const links = menu.length
    ? html`<nav aria-label="Footer"><ul class="footer-menu">${menuItems(menu, ctx, 'footer-sub')}</ul></nav>`
    : '';
  return html`<div class="footer-body">${links}${f.footer ? ctx.richText(f.footer) : ''}<p class="footer-legal">© ${ctx.year} ${f.name ?? ''}</p></div>`;
}
