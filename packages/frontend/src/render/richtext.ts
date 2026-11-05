import {
  excerpt,
  type RichTextTarget,
  safeLinkUri,
  toHtml,
  toPlainText,
} from '@contentworker/sdk/rich-text';
import { attrs, escapeHtml, raw, type Safe } from '../html.ts';
import {
  isAsset,
  isEntry,
  type RenderCtx,
  type RichTextDocument,
  type RichTextNode,
} from '../types.ts';

type RichCtx = Pick<RenderCtx, 'pathFor' | 'renderBlock' | 'image'> & { origin?: string };

/**
 * Rich text, rendered by `@contentworker/sdk/rich-text` (the same renderer any frontend uses):
 * text escaped, only safe links, every node type handled. The runtime adds only what is its own:
 * entry links through the route table, embedded entries through the block registry, embedded
 * images through `ctx.image` (which picks the LCP image and sets sizes and the placeholder
 * colour), the CTA rule for buttons, and a scroll wrapper for tables.
 */

/** A link URL that is safe to emit (the CMS's own rule, via the SDK), or null. */
export function safeHref(uri: unknown): string | null {
  return safeLinkUri(uri) ?? null;
}

const entryHref = (ctx: RichCtx) => (target: RichTextTarget) =>
  isEntry(target) ? ctx.pathFor(target) : null;

/**
 * The CTA rule, applied server-side: a paragraph holding only
 * one link whose text is all bold becomes a primary button, all italic a secondary one, both an
 * accent one.
 */
function button(n: RichTextNode, ctx: RichCtx): string | undefined {
  const parts = (n.content ?? []).filter((c) => !(c.nodeType === 'text' && !c.value?.trim()));
  const only = parts.length === 1 ? parts[0] : undefined;
  if (!only || !/hyperlink$/.test(only.nodeType)) return undefined;
  const texts = (only.content ?? []).filter((c) => c.nodeType === 'text' && c.value?.trim());
  const all = (type: string) =>
    texts.length > 0 && texts.every((t) => t.marks?.some((m) => m.type === type));
  const bold = all('bold');
  const italic = all('italic');
  if (!bold && !italic) return undefined;
  const target = only.data?.target;
  let href: string | null;
  if (only.nodeType === 'entry-hyperlink') href = isEntry(target) ? ctx.pathFor(target) : null;
  else if (only.nodeType === 'asset-hyperlink')
    href = isAsset(target) ? safeHref(target.url) : null;
  else href = safeHref(only.data?.uri);
  if (!href) return undefined;
  const variant = bold && italic ? 'accent' : bold ? 'primary' : 'secondary';
  const label = escapeHtml(texts.map((t) => t.value).join(''));
  return `<p class="button-wrapper"><a${attrs({ href, class: `button ${variant}` }).value}>${label}</a></p>`;
}

export function renderRichText(doc: RichTextDocument | null | undefined, ctx: RichCtx): Safe {
  return raw(
    toHtml(doc, {
      entryHref: entryHref(ctx),
      renderEntry: (target, { inline }) =>
        isEntry(target) ? ctx.renderBlock(target, { inline }).value : '',
      renderAsset: (asset) => {
        if (!isAsset(asset)) return '';
        const caption = asset.description
          ? `<figcaption>${escapeHtml(asset.description)}</figcaption>`
          : '';
        return `<figure>${ctx.image(asset, { sizes: '(min-width: 900px) 800px, 100vw' }).value}${caption}</figure>`;
      },
      nodes: {
        paragraph: (n) => button(n, ctx),
        table: (_n, next) => `<div class="table-wrapper"><table>${next()}</table></div>`,
      },
    }),
  );
}

/** The plain text of a node and its descendants. */
export function plain(n: RichTextNode | null | undefined): string {
  return toPlainText(n);
}

/** The first paragraph's text, for a fallback meta description. */
export function firstParagraph(doc: RichTextDocument | null | undefined, max = 160): string {
  return excerpt(doc, max);
}
