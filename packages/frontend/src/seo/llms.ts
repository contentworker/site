import type { Delivery } from '../delivery.ts';
import { pageMarkdown } from '../render/markdown.ts';
import { firstParagraph } from '../render/richtext.ts';
import { listingFor, pathFor, routedTypes } from '../routes.ts';
import type { Entry, MarkdownCtx } from '../types.ts';

/**
 * llms.txt (https://llmstxt.org): a Markdown map of the site for language models, linking each
 * page's Markdown twin. llms-full.txt is every page's Markdown in one file, capped so it stays
 * a reasonable single fetch.
 */
export const FULL_MAX = 200;
const TITLES: Record<string, string> = { page: 'Pages', article: 'Articles' };
/** A section title for a type: its listing's title, a known name, or the type itself. */
const titleFor = (type: string): string => TITLES[type] ?? listingFor(type)?.title ?? type;

const describe = (e: Entry): string =>
  e.fields?.seo?.description || firstParagraph(e.fields?.body) || '';
const indexable = (e: Entry | null | undefined): boolean =>
  Boolean(!e?.fields?.seo?.noindex && pathFor(e));
const mdPath = (path: string): string => (path === '/' ? '/index.md' : `${path}.md`);

export async function llmsTxt({
  delivery,
  origin,
  settings,
}: {
  delivery: Delivery;
  origin: string;
  settings: Entry | null;
}): Promise<string> {
  const f = settings?.fields ?? {};
  const out: string[] = [`# ${f.name ?? origin}`];
  const summary = f.llmsSummary || f.description;
  if (summary) out.push(`> ${summary}`);
  for (const type of routedTypes()) {
    const items: string[] = [];
    for await (const e of delivery.iterate(type, {
      select: 'fields.slug,fields.title,fields.seo',
      include: 0,
      max: 1000,
    })) {
      if (!indexable(e)) continue;
      const desc = describe(e);
      items.push(
        `- [${e.fields.title ?? e.fields.slug}](${origin}${mdPath(pathFor(e) ?? '/')})${desc ? `: ${desc}` : ''}`,
      );
    }
    if (items.length) out.push(`## ${titleFor(type)}\n\n${items.join('\n')}`);
  }
  out.push(`## Optional\n\n- [Everything on one page](${origin}/llms-full.txt)`);
  return `${out.join('\n\n')}\n`;
}

export async function llmsFullTxt({
  delivery,
  origin,
  markdownFor,
}: {
  delivery: Delivery;
  origin: string;
  markdownFor?: MarkdownCtx['markdownFor'];
}): Promise<string> {
  const parts: string[] = [];
  for (const type of routedTypes()) {
    for await (const e of delivery.iterate(type, { include: 4, max: FULL_MAX - parts.length })) {
      if (!indexable(e)) continue;
      parts.push(pageMarkdown(e, { origin, description: describe(e), markdownFor }));
    }
  }
  return parts.join('\n---\n\n');
}
