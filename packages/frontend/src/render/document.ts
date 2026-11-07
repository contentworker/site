import { toClassName } from '../../public/scripts/shared.js';
import { type ContentRef, formatContentRef } from '../content-ref.ts';
import { attrs, html, type Safe } from '../html.ts';
import { stayInPreview } from '../preview-links.ts';
import {
  blockKey,
  type Entry,
  isBlocksField,
  type Menus,
  type PreviewState,
  type RenderCtx,
  sectionsIn,
} from '../types.ts';
import { createRenderCtx } from './block-ctx.ts';
import {
  BLOCKS,
  blockCss,
  blockShell,
  CHROME,
  DEFAULT_CONTENT,
  modulesIn,
  structuredDataIn,
} from './blocks.ts';
import { jsonLd, renderHead, seoFor } from './head.ts';
import { renderRichText } from './richtext.ts';

/**
 * Renders a page as a stream of HTML strings. The HTML is finished as sent: sections, wrappers,
 * buttons and images are all decided here, in the Worker, so the page reads fully with JS off
 * and the client only enhances.
 *
 * Order: head and header first (TTFB only waits for the page entry), then one chunk per section.
 * Later sections link their block CSS just before they start: content above keeps painting, and
 * a block never shows unstyled.
 */
export interface DocumentInput {
  entry: Entry | null;
  settings: Entry | null;
  menus?: Menus;
  url: URL;
  origin: string;
  codeBase: string;
  lang: string;
  notFound: boolean;
  preview?: PreviewState | undefined;
}

export async function* renderDocument(input: DocumentInput): AsyncGenerator<string> {
  const session = input.preview?.session;
  if (!session) {
    yield* renderPage(input);
    return;
  }
  // Framed for a live preview session: links to the site's pages stay in preview.
  const origins = [...new Set([input.origin, input.url.origin])];
  for await (const chunk of renderPage(input)) yield stayInPreview(chunk, { origins, session });
}

async function* renderPage(input: DocumentInput): AsyncGenerator<string> {
  const { entry, settings, menus, url, origin, codeBase, lang, notFound, preview } = input;
  const ctx = createRenderCtx({ path: url.pathname, origin, ...(menus ? { menus } : {}) });

  const sections = sectionsOf(entry);
  const firstMods = sections[0] ? modulesOf(sections[0]) : [];
  const seo = seoFor({ entry, settings, url: `${origin}${url.pathname}`, notFound });
  if (preview) {
    seo.noindex = true;
    seo.canonical = null;
  }
  const ld = jsonLd({ entry, settings, seo, origin, extra: structuredDataIn(sections) });
  const marks = marksFor(preview);

  yield `<!doctype html><html${attrs({ lang })}><head>`;
  yield renderHead({
    seo,
    ld: preview ? null : ld,
    codeBase,
    firstCss: blockCss(firstMods, codeBase),
    lang,
  }).value;
  if (preview?.live) {
    // Live preview only (framed by the admin with cw_session): the page side of the protocol.
    yield html`<meta name="cw-admin-origin"${attrs({ content: preview.live.admin })}><script type="module"${attrs({ src: `${codeBase}/scripts/live-preview.js` })}></script>`
      .value;
  }
  yield '</head><body>';
  if (preview?.session) {
    // Framed by the admin, which has its own controls: an exit link would load a public page,
    // and public pages refuse to be framed.
    yield html`<div class="preview-bar" role="status">Previewing a draft.</div>`.value;
  } else if (preview) {
    yield html`<div class="preview-bar" role="status">Previewing a draft. <a href="${`/__preview/exit?to=${encodeURIComponent(preview.path)}`}">Exit preview</a></div>`
      .value;
  }
  const slot = marks && isBlocksField(entry?.fields?.sections) ? 'sections' : null;
  yield html`<a class="skip-link" href="#main">Skip to content</a><header>${blockShell(CHROME.header, CHROME.header.default(settings, ctx))}</header><main${attrs({ id: 'main', 'data-cw-slot': slot })}>`
    .value;

  const linked = new Set(blockCss(firstMods, codeBase));
  for (const part of mainParts({ entry, sections, ctx, codeBase, linked, marks })) yield part.html;
  if (notFound) yield notFoundSection().value;

  const footerCss = blockCss([CHROME.footer], codeBase).filter((href) => !linked.has(href));
  yield html`</main>${footerCss.map((href) => html`<link rel="stylesheet"${attrs({ href })}>`)}<footer>${blockShell(CHROME.footer, CHROME.footer.default(settings, ctx))}</footer></body></html>`
    .value;
}

/** Makes the `data-cw-ref` value for one of the draft's fields, or null outside a draft preview. */
export type Marks = ((field: string) => string) | null;

export function marksFor(preview: PreviewState | undefined): Marks {
  const entry = preview?.entry;
  const scope = preview?.scope;
  if (!entry || !scope || !entry.id) return null;
  return (field) => {
    const ref: ContentRef = {
      space: scope.space,
      environment: scope.environment,
      entryId: entry.id,
      contentType: entry.contentType,
      field,
      locale: scope.locale,
    };
    return formatContentRef(ref);
  };
}

/** One piece of <main>: the page title, or a section (with the block CSS it newly needs). */
export interface MainPart {
  /** The section's blocks-field `_key`, when it has one. */
  key?: string | undefined;
  /** The section's index in the entry's sections; undefined for the page's own title. */
  index?: number | undefined;
  /** Block CSS hrefs this part linked first (its `html` starts with their links). */
  css: string[];
  /** Every block CSS href the part needs, linked earlier or not. */
  needs: string[];
  /** The part's own element, without the stylesheet links in front of it. */
  section: string;
  html: string;
}

/**
 * Everything <main> holds before the not-found notice, in order. Page renders and the preview
 * re-render endpoint both come through here, so a re-rendered block is the block the page shows.
 */
export function* mainParts({
  entry,
  sections = sectionsOf(entry),
  ctx,
  codeBase,
  linked,
  marks = null,
}: {
  entry: Entry | null;
  sections?: Entry[];
  ctx: RenderCtx;
  codeBase: string;
  linked: Set<string>;
  marks?: Marks;
}): Generator<MainPart> {
  if (entry?.contentType === 'listing') {
    const section =
      html`<section class="section listing-head"><div class="default-content-wrapper"><h1>${entry.fields.title}</h1></div></section>`
        .value;
    yield { css: [], needs: [], section, html: section };
    ctx.headingLevel = 2;
  } else if (entry && sections[0] && !titledBy(sections[0])) {
    // Every page has exactly one h1, before any block heading (heading order is an a11y audit).
    const ref = marks ? marks(entry.fields.seo?.h1 ? 'seo' : 'title') : null;
    const section =
      html`<section class="section page-head"><div class="default-content-wrapper"><h1${attrs({ 'data-cw-ref': ref })}>${entry.fields.seo?.h1 || entry.fields.title}</h1></div></section>`
        .value;
    yield { css: [], needs: [], section, html: section };
    ctx.headingLevel = 2;
  }
  for (const [i, section] of sections.entries()) {
    const needs = blockCss(modulesOf(section), codeBase);
    const css = needs.filter((href) => !linked.has(href));
    for (const href of css) linked.add(href);
    ctx.inFirstSection = i === 0;
    const own = renderSection(section, i, ctx, marks);
    yield {
      key: blockKey(section),
      index: i,
      css,
      needs,
      section: own.value,
      html: html`${css.map((href) => html`<link rel="stylesheet"${attrs({ href })}>`)}${own}`.value,
    };
  }
}

/** A page's sections (linked entries or blocks-field elements), or one from its `body`. */
export function sectionsOf(entry: Entry | null): Entry[] {
  if (!entry?.fields) return [];
  const f = entry.fields;
  if (Array.isArray(f.sections)) return sectionsIn(f.sections);
  if (f.body) {
    const body: Entry = {
      id: `${entry.id}:body`,
      contentType: DEFAULT_CONTENT,
      fields: { body: f.body, heading: f.title },
    };
    PAGE_BODY.add(body);
    return [body];
  }
  return [];
}

/** The sections sectionsOf made from a page's own body and title (their refs are the page's). */
const PAGE_BODY = new WeakSet<Entry>();

const modulesOf = (section: Entry) => modulesIn(section);

/** Whether a first section renders the h1 itself: a hero, or default content carrying a heading. */
const titledBy = (section: Entry): boolean =>
  (section.contentType === DEFAULT_CONTENT && Boolean(section.fields.heading)) ||
  Boolean(BLOCKS.get(section.contentType)?.ownsTitle);

function renderSection(section: Entry, index: number, ctx: RenderCtx, marks: Marks): Safe {
  const style = section.fields?.style ? toClassName(section.fields.style) : null;
  // Every section starts 'initialized'; scripts/lib.js marks it 'loaded' once its block JS ran.
  const status = 'initialized';
  if (section.contentType === DEFAULT_CONTENT) {
    // A page's own body and title (sectionsOf) carry the page's refs; a richText block its key.
    const own = marks && PAGE_BODY.has(section) ? marks : null;
    const { heading, body } = section.fields;
    let title: Safe | string = '';
    if (heading && index === 0 && ctx.headingLevel === 1) {
      title = html`<h1${attrs({ 'data-cw-ref': own ? own('title') : null })}>${heading}</h1>`;
      ctx.headingLevel = 2;
    }
    return html`<section${attrs({ class: ['section', style].filter(Boolean).join(' '), 'data-section-status': status, 'data-cw-block': marks ? (blockKey(section) ?? null) : null, 'data-cw-ref': own ? own('body') : null })}><div class="default-content-wrapper">${title}${renderRichText(body, ctx)}</div></section>`;
  }
  const mod = BLOCKS.get(section.contentType);
  if (!mod) return html``;
  ctx.usedBlocks.add(mod);
  return html`<section${attrs({
    class: ['section', `${mod.name}-container`, style].filter(Boolean).join(' '),
    'data-section-status': status,
    'data-cw-block': marks ? (blockKey(section) ?? null) : null,
  })}><div class="${mod.name}-wrapper">${blockShell(mod, mod.default(section, ctx))}</div></section>`;
}

function notFoundSection() {
  return html`<section class="section not-found" data-section-status="loaded"><div class="default-content-wrapper"><h1>Page not found</h1><p>The page you asked for isn’t here. It may have moved.</p><p class="button-wrapper"><a class="button secondary" href="/">Go to the home page</a></p></div></section>`;
}
