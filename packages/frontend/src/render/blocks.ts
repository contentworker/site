// new-block:imports (scripts/new-block.mjs adds lines below)
import * as articleList from '../../public/blocks/article-list/article-list.render.ts';
import * as cards from '../../public/blocks/cards/cards.render.ts';
import * as columns from '../../public/blocks/columns/columns.render.ts';
import * as cta from '../../public/blocks/cta/cta.render.ts';
import * as faq from '../../public/blocks/faq/faq.render.ts';
import * as footer from '../../public/blocks/footer/footer.render.ts';
import * as fragment from '../../public/blocks/fragment/fragment.render.ts';
import * as header from '../../public/blocks/header/header.render.ts';
import * as hero from '../../public/blocks/hero/hero.render.ts';
import * as media from '../../public/blocks/media/media.render.ts';
import { attrs, html, type Safe } from '../html.ts';
import {
  type BlockModule,
  type ChromeModule,
  type Entry,
  isEntry,
  type MarkdownCtx,
  type RenderCtx,
  type RichTextNode,
  sectionsIn,
} from '../types.ts';

/**
 * The block registry. A block is a folder in public/blocks/<name>/ with:
 *   <name>.render.js  server half: entry → semantic HTML (imported here, never served)
 *   <name>.css        styles, linked by the Worker just before the block's section
 *   <name>.js         optional client enhancement, loaded by scripts/enhance.js `enhanceBlock`
 * Each render module exports `name`, `contentType`, `css` and `js` (booleans) and a default
 * `render(entry, ctx)`. `npm run new-block <name>` scaffolds one and registers it here.
 * Optional exports: `markdown(entry, ctx)` for the Markdown twin, `structuredData(entry)` for
 * JSON-LD nodes in <head>.
 */
const MODULES: BlockModule[] = [
  // new-block:modules
  articleList,
  cards,
  columns,
  cta,
  faq,
  fragment,
  hero,
  media,
];

export const BLOCKS = new Map<string, BlockModule>(
  MODULES.map((m) => [m.contentType ?? m.name, m]),
);
export const CHROME: { header: ChromeModule; footer: ChromeModule } = { header, footer };

/** The content type rendered as plain default content (no block wrapper, no CSS or JS). */
export const DEFAULT_CONTENT = 'richText';

/** The <div class="<name> block"> shell around a block's own markup. */
export function blockShell(mod: Pick<BlockModule, 'name' | 'css' | 'js'>, inner: Safe): Safe {
  return html`<div${attrs({
    class: `${mod.name} block`,
    'data-block': mod.name,
    'data-block-state': mod.js ? 'pending' : 'done',
    'data-block-js': mod.js ? null : '0',
    'data-block-css': mod.css ? null : '0',
  })}>${inner}</div>`;
}

/** The CSS hrefs a set of block modules needs, under the versioned code path. */
export function blockCss(mods: Pick<BlockModule, 'name' | 'css'>[], codeBase: string): string[] {
  return [
    ...new Set(mods.filter((m) => m.css).map((m) => `${codeBase}/blocks/${m.name}/${m.name}.css`)),
  ];
}

/** Entries embedded inline in rich text render through the same registry, without a section. */
export function renderEmbedded(entry: Entry, ctx: RenderCtx): Safe {
  const mod = BLOCKS.get(entry.contentType);
  if (!mod) return html``;
  ctx.usedBlocks.add(mod);
  return blockShell(mod, mod.default(entry, ctx));
}

/** Every block module a section uses, including blocks inside fragments and rich text. */
export function modulesIn(section: Entry | null | undefined, depth = 0): BlockModule[] {
  if (!section?.fields || depth > 3) return [];
  const mod = BLOCKS.get(section.contentType);
  const out = mod ? [mod] : [];
  if (section.contentType === 'fragment') {
    const source = isEntry(section.fields.fragment) ? section.fields.fragment : section;
    for (const s of sectionsIn(source.fields.sections)) out.push(...modulesIn(s, depth + 1));
  }
  for (const value of Object.values(section.fields) as unknown[]) {
    const doc = value as RichTextNode | null;
    if (doc?.nodeType !== 'document') continue;
    for (const n of doc.content ?? []) {
      const target = n.data?.target;
      if (n.nodeType === 'embedded-entry-block' && isEntry(target))
        out.push(...modulesIn(target, depth + 1));
    }
  }
  return out;
}

/** JSON-LD nodes contributed by blocks (FAQPage from faq), found before the head is written. */
export function structuredDataIn(sections: Entry[]): Record<string, unknown>[] {
  return sections.flatMap((s) => collect(s, 0));
}

function collect(entry: Entry | null | undefined, depth: number): Record<string, unknown>[] {
  if (!entry?.fields || depth > 3) return [];
  const mod = BLOCKS.get(entry.contentType);
  const own = mod?.structuredData ? mod.structuredData(entry) : [];
  const nested =
    entry.contentType === 'fragment'
      ? sectionsIn(
          (isEntry(entry.fields.fragment) ? entry.fields.fragment : entry).fields.sections,
        ).flatMap((s) => collect(s, depth + 1))
      : [];
  return [...own, ...nested];
}

/** A block's own Markdown, when its module exports one. */
export function markdownFor(entry: Entry, ctx: MarkdownCtx): string | null {
  const mod = BLOCKS.get(entry?.contentType);
  return mod?.markdown ? mod.markdown(entry, ctx) : null;
}

/** Adds a site's blocks; one with the same content type replaces the runtime's. */
export function registerBlocks(mods: readonly BlockModule[]): void {
  for (const m of mods) BLOCKS.set(m.contentType ?? m.name, m);
}

/** Replaces the runtime's header or footer. */
export function setChrome(chrome: Partial<typeof CHROME>): void {
  if (chrome.header) CHROME.header = chrome.header;
  if (chrome.footer) CHROME.footer = chrome.footer;
}
