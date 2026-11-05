import { html, type Safe } from '../../../src/html.ts';
import { type Entry, isEntry, type RenderCtx, sectionsIn } from '../../../src/types.ts';

/**
 * Fragment: a reusable entry (a shared promo, a signup band) linked from many pages. Its own
 * `sections` render in place, server-side, so there's no extra request. Publishing the fragment
 * purges every page that embeds it, because its id is in their Cache-Tag. Fields: title (internal), sections[] (block entries).
 */
export const name = 'fragment';
export const contentType = 'fragment';
export const css = false;
export const js = false;

export default function render(entry: Entry, ctx: RenderCtx): Safe {
  if (ctx.fragmentDepth >= 3) return html``; // a fragment that includes itself stops here
  ctx.fragmentDepth = (ctx.fragmentDepth ?? 0) + 1;
  // As a blocks element the fragment is a link ({ _type: 'fragment', fragment }); as a linked
  // entry it is the fragment itself.
  const source = isEntry(entry.fields.fragment) ? entry.fields.fragment : entry;
  const out = html`${sectionsIn(source.fields.sections).map((s) => ctx.renderBlock(s))}`;
  ctx.fragmentDepth -= 1;
  return out;
}
