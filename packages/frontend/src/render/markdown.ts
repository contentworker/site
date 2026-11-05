import { escapeMarkdown, toMarkdown } from '@contentworker/sdk/rich-text';
import { pathFor } from '../routes.ts';
import {
  type Entry,
  isEntry,
  type MarkdownCtx,
  type RichTextDocument,
  type RichTextNode,
  sectionsIn,
} from '../types.ts';

/**
 * Markdown twins of pages, for answer engines and agents (GEO). Rich text goes through
 * `@contentworker/sdk/rich-text`'s `toMarkdown` (the same renderer any frontend uses); this file
 * assembles a page from its title, summary and sections, and makes links absolute on this site.
 * It is a render target, like HTML: nothing stores Markdown.
 */
const escapeInline = escapeMarkdown;

/** An entry's absolute URL on this site, for links in Markdown. */
export function linkFor(entry: Partial<Entry> | null | undefined, ctx: MarkdownCtx): string | null {
  const path = pathFor(entry);
  return path ? `${ctx.origin}${path}` : null;
}

/** A RichTextDocument as Markdown: entry links absolute, embedded entries as their own Markdown. */
export function richTextToMarkdown(
  doc: RichTextDocument | RichTextNode | null | undefined,
  ctx: MarkdownCtx,
): string {
  if (doc?.nodeType !== 'document') return '';
  return toMarkdown(doc as RichTextDocument, {
    entryHref: (target) => (isEntry(target) ? linkFor(target, ctx) : null),
    renderEntry: (target, { inline }) =>
      isEntry(target)
        ? inline
          ? escapeInline(target.fields.title ?? '')
          : entryMarkdown(target, ctx)
        : '',
  });
}

export function entryMarkdown(entry: Entry | null | undefined, ctx: MarkdownCtx): string {
  if (!entry?.fields) return '';
  const custom = ctx.markdownFor?.(entry, ctx);
  if (custom != null) return custom;
  const f = entry.fields;
  const out = [];
  const title = f.heading ?? (entry.contentType === 'richText' ? null : f.title);
  if (title) out.push(`## ${escapeInline(title)}`);
  for (const value of Object.values(f)) {
    if (value?.nodeType === 'document') out.push(richTextToMarkdown(value, ctx));
  }
  return out.filter(Boolean).join('\n\n');
}

/** A whole page: title, summary, source link, then its sections. */
export function pageMarkdown(
  entry: Entry,
  {
    origin,
    description,
    markdownFor,
  }: { origin: string; description?: string; markdownFor?: MarkdownCtx['markdownFor'] },
): string {
  const ctx: MarkdownCtx = markdownFor ? { origin, markdownFor } : { origin };
  const f = entry.fields ?? {};
  const url = linkFor(entry, ctx);
  const head = [`# ${escapeInline(f.title ?? f.heading ?? '')}`];
  if (description) head.push(`> ${escapeInline(description)}`);
  if (url) head.push(`Source: ${url}`);
  const sections = Array.isArray(f.sections)
    ? sectionsIn(f.sections).map((s) => {
        // The hero's heading is the page title already.
        if (s?.contentType === 'hero') return richTextToMarkdown(s.fields?.lead, ctx);
        if (s?.contentType === 'fragment')
          return sectionsIn((isEntry(s.fields?.fragment) ? s.fields.fragment : s).fields?.sections)
            .map((x) => entryMarkdown(x, ctx))
            .filter(Boolean)
            .join('\n\n');
        return entryMarkdown(s, ctx);
      })
    : [richTextToMarkdown(f.body, ctx)];
  return `${[head.join('\n\n'), ...sections.filter(Boolean)].join('\n\n')}\n`;
}
