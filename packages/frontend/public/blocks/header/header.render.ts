import { attrs, html, type Safe } from '../../../src/html.ts';
import type { Entry, Fields, RenderCtx } from '../../../src/types.ts';

/**
 * Site header from siteSettings. Navigation works with JS off: on mobile a native <details>
 * toggles the link list (CSS :has), on desktop the list always shows. header.js only adds
 * Escape-to-close and focus handling.
 */
export const name = 'header';
export const contentType = null;
export const css = false; // header styles are in eager.css: the header is always above the fold
export const js = true;

export default function render(settings: Entry | null, ctx: RenderCtx): Safe {
  const f = settings?.fields ?? {};
  const items = (Array.isArray(f.nav) ? f.nav : []).map((item: Fields) => {
    const href = item.link ? ctx.pathFor(item.link) : ctx.safeHref(item.url);
    if (!href || !item.label) return '';
    const current = href === ctx.path ? 'page' : null;
    return html`<li><a${attrs({ href, 'aria-current': current })}>${item.label}</a></li>`;
  });
  return html`<nav class="nav" aria-label="Main">
<a class="nav-brand" href="/">${f.name ?? 'Home'}</a>
<details class="nav-menu"><summary aria-label="Menu" aria-controls="nav-sections"><span class="nav-menu-icon"></span></summary></details>
<ul class="nav-sections" id="nav-sections">${items}</ul>
</nav>`;
}
