import { attrs, html, type Safe } from '../html.ts';
import type { MenuItem, RenderCtx } from '../types.ts';

/**
 * A ContentWorker navigation menu as list items. Delivery serves it resolved for the locale, with
 * unpublished links already dropped. An item with no safe URL (a term, which has no page here)
 * gives way to its children, as Delivery does for a link that doesn't resolve. The CMS limits
 * `attrs` to rel, title, class, aria-label and data-*, so an item can't carry a handler or href.
 */
export function menuItems(items: readonly MenuItem[], ctx: RenderCtx, subClass: string): Safe[] {
  return items.flatMap((item) => {
    const href = ctx.safeHref(item.url);
    const children = menuItems(item.children ?? [], ctx, subClass);
    if (!href || !item.label) return children;
    const blank = item.target === '_blank';
    const link = attrs({
      ...item.attrs,
      href,
      target: blank ? '_blank' : null,
      rel: blank ? (item.attrs?.rel ?? 'noopener') : (item.attrs?.rel ?? null),
      'aria-current': href === ctx.path ? 'page' : null,
    });
    const sub = children.length ? html`<ul${attrs({ class: subClass })}>${children}</ul>` : '';
    return [html`<li><a${link}>${item.label}</a>${sub}</li>`];
  });
}
