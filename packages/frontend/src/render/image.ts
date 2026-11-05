import { attrs, html, type Safe } from '../html.ts';
import type { Asset, ImageOptions } from '../types.ts';

/**
 * A responsive <img> from a delivered ContentWorker asset. Media URLs are signed, so they come
 * from the asset (`srcset`, `renditions`) and are never built here. The media origin picks
 * AVIF/WebP from `Accept`, so one <img> with a srcset is enough; no <source type> fan-out.
 *
 * @param {object} asset a delivered asset ({ url, srcset, width, height, altText, placeholder })
 * @param {object} ctx the render context (holds the LCP state)
 * @param {{ sizes?: string, rendition?: string, className?: string }} [opts]
 */
export function image(
  asset: Asset | null | undefined,
  ctx: { inFirstSection?: boolean; lcpTaken?: boolean },
  opts: ImageOptions = {},
): Safe {
  if (!asset?.url || asset.kind === 'video') return html``;
  // The first image of the first section is the LCP candidate: fetch it now, at high priority.
  // Decided in the HTML, so the preload scanner sees it.
  const lcp = ctx.inFirstSection && !ctx.lcpTaken;
  if (lcp) ctx.lcpTaken = true;

  const src =
    (opts.rendition && asset.renditions?.[opts.rendition]) || pick(asset.srcset, 960) || asset.url;
  const srcset = opts.rendition
    ? null
    : (asset.srcset ?? []).map((s) => `${s.url} ${s.width}w`).join(', ');
  const color = asset.placeholder?.dominantColor;

  return html`<img${attrs({
    src,
    srcset: srcset || null,
    sizes: srcset ? (opts.sizes ?? '100vw') : null,
    width: asset.width,
    height: asset.height,
    alt: asset.altText ?? '',
    loading: lcp ? 'eager' : 'lazy',
    fetchpriority: lcp ? 'high' : null,
    decoding: lcp ? null : 'async',
    class: opts.className ?? null,
    style: color && /^#[0-9a-f]{6}$/i.test(color) ? `background-color:${color}` : null,
  })}>`;
}

/** The smallest ladder URL at least `width` wide, else the largest there is. */
function pick(srcset: Asset['srcset'], width: number): string | null {
  if (!srcset?.length) return null;
  const sorted = [...srcset].sort((a, b) => a.width - b.width);
  return (sorted.find((s) => s.width >= width) ?? sorted[sorted.length - 1])?.url ?? null;
}

/** The URL for og:image: the `og` rendition when the space has one, else ~1280 wide. */
export function shareImageUrl(asset: Asset | null | undefined): string | null {
  if (!asset?.url) return null;
  return asset.renditions?.og ?? pick(asset.srcset, 1280) ?? asset.url;
}
