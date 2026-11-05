import { attrs, html, type Safe } from '../../../src/html.ts';
import type { Entry, RenderCtx } from '../../../src/types.ts';

/**
 * Media: one image or video with an optional caption. Video is a native <video> with
 * preload="none" and the Stream poster, so it costs one small image until the visitor presses
 * play; HLS plays natively where supported, with a download link as the fallback. No JS.
 * Fields: asset (image or video), caption (Symbol), wide (Boolean).
 */
export const name = 'media';
export const contentType = 'media';
export const css = true;
export const js = false;

export default function render(entry: Entry, ctx: RenderCtx): Safe {
  const { asset, caption, wide } = entry.fields;
  if (!asset?.url) return html``;
  const sizes = wide ? '100vw' : '(min-width: 1200px) 1136px, 100vw';
  let body: Safe;
  if (asset.kind === 'video' || asset.video) {
    const v = asset.video ?? {};
    const src = v.hlsUrl ?? asset.url;
    body = html`<video${attrs({
      controls: true,
      preload: 'none',
      playsinline: true,
      poster: v.thumbnailUrl ?? null,
      width: asset.width ?? 1920,
      height: asset.height ?? 1080,
      'aria-label': asset.title ?? caption ?? 'Video',
    })}><source${attrs({ src, type: src.endsWith('.m3u8') ? 'application/x-mpegURL' : asset.contentType })}><a href="${src}">Download the video</a></video>`;
  } else {
    body = ctx.image(asset, { sizes });
  }
  const credit = asset.rights?.credit;
  return html`<figure${attrs({ class: wide ? 'media-wide' : null })}>${body}${
    caption || credit
      ? html`<figcaption>${caption ?? ''}${credit ? html` <span class="media-credit">${credit}</span>` : ''}</figcaption>`
      : ''
  }</figure>`;
}
