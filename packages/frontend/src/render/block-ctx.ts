import { raw } from '../html.ts';
import { pathFor } from '../routes.ts';
import { isEntry, type RenderCtx } from '../types.ts';
import { renderEmbedded } from './blocks.ts';
import { image } from './image.ts';
import { renderRichText, safeHref } from './richtext.ts';

/**
 * The context every block renderer receives: helpers that keep markup safe (richText, image,
 * href) and the per-page render state (heading level, the LCP image, fragment depth).
 * @param {{ path?: string, origin?: string }} [opts]
 */
export function createRenderCtx({
  path = '/',
  origin = '',
}: {
  path?: string;
  origin?: string;
} = {}): RenderCtx {
  const ctx: RenderCtx = {
    path,
    origin,
    year: new Date().getUTCFullYear(),
    headingLevel: 1,
    inFirstSection: false,
    lcpTaken: false,
    fragmentDepth: 0,
    usedBlocks: new Set(),
    raw,
    safeHref,
    pathFor,
    href: (link) => {
      if (isEntry(link)) return pathFor(link);
      if (typeof link === 'string') return safeHref(link);
      return safeHref((link as { url?: unknown } | null | undefined)?.url);
    },
    image: (asset, opts) => image(asset, ctx, opts),
    richText: (doc) => renderRichText(doc, ctx),
    renderBlock: (e) => renderEmbedded(e, ctx),
  };
  return ctx;
}
