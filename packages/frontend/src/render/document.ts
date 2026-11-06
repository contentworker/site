import { toClassName } from '../../public/scripts/shared.js';
import { attrs, html, type Safe } from '../html.ts';
import { type Entry, type Menus, type RenderCtx, sectionsIn } from '../types.ts';
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
  preview?: { entry: Entry | null; path: string } | undefined;
}

export async function* renderDocument(input: DocumentInput): AsyncGenerator<string> {
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

  yield `<!doctype html><html${attrs({ lang })}><head>`;
  yield renderHead({
    seo,
    ld: preview ? null : ld,
    codeBase,
    firstCss: blockCss(firstMods, codeBase),
    lang,
  }).value;
  yield '</head><body>';
  if (preview) {
    yield html`<div class="preview-bar" role="status">Previewing a draft. <a href="${`/__preview/exit?to=${encodeURIComponent(preview.path)}`}">Exit preview</a></div>`
      .value;
  }
  yield html`<a class="skip-link" href="#main">Skip to content</a><header>${blockShell(CHROME.header, CHROME.header.default(settings, ctx))}</header><main id="main">`
    .value;

  if (entry?.contentType === 'listing') {
    yield html`<section class="section listing-head"><div class="default-content-wrapper"><h1>${entry.fields.title}</h1></div></section>`
      .value;
    ctx.headingLevel = 2;
  } else if (entry && sections[0] && !titledBy(sections[0])) {
    // Every page has exactly one h1, before any block heading (heading order is an a11y audit).
    yield html`<section class="section page-head"><div class="default-content-wrapper"><h1>${entry.fields.seo?.h1 || entry.fields.title}</h1></div></section>`
      .value;
    ctx.headingLevel = 2;
  }
  const linked = new Set(blockCss(firstMods, codeBase));
  for (const [i, section] of sections.entries()) {
    const mods = modulesOf(section);
    const css = blockCss(mods, codeBase).filter((href) => !linked.has(href));
    for (const href of css) linked.add(href);
    ctx.inFirstSection = i === 0;
    yield html`${css.map((href) => html`<link rel="stylesheet"${attrs({ href })}>`)}${renderSection(section, i, ctx)}`
      .value;
  }
  if (notFound) yield notFoundSection().value;

  const footerCss = blockCss([CHROME.footer], codeBase).filter((href) => !linked.has(href));
  yield html`</main>${footerCss.map((href) => html`<link rel="stylesheet"${attrs({ href })}>`)}<footer>${blockShell(CHROME.footer, CHROME.footer.default(settings, ctx))}</footer></body></html>`
    .value;
}

/** A page's sections (linked entries or blocks-field elements), or one from its `body`. */
function sectionsOf(entry: Entry | null): Entry[] {
  if (!entry?.fields) return [];
  const f = entry.fields;
  if (Array.isArray(f.sections)) return sectionsIn(f.sections);
  if (f.body)
    return [
      {
        id: `${entry.id}:body`,
        contentType: DEFAULT_CONTENT,
        fields: { body: f.body, heading: f.title },
      },
    ];
  return [];
}

const modulesOf = (section: Entry) => modulesIn(section);

/** Whether a first section renders the h1 itself: a hero, or default content carrying a heading. */
const titledBy = (section: Entry): boolean =>
  (section.contentType === DEFAULT_CONTENT && Boolean(section.fields.heading)) ||
  Boolean(BLOCKS.get(section.contentType)?.ownsTitle);

function renderSection(section: Entry, index: number, ctx: RenderCtx): Safe {
  const style = section.fields?.style ? toClassName(section.fields.style) : null;
  // Every section starts 'initialized'; scripts/lib.js marks it 'loaded' once its block JS ran.
  const status = 'initialized';
  if (section.contentType === DEFAULT_CONTENT) {
    const { heading, body } = section.fields;
    let title: Safe | string = '';
    if (heading && index === 0 && ctx.headingLevel === 1) {
      title = html`<h1>${heading}</h1>`;
      ctx.headingLevel = 2;
    }
    return html`<section${attrs({ class: ['section', style].filter(Boolean).join(' '), 'data-section-status': status })}><div class="default-content-wrapper">${title}${renderRichText(body, ctx)}</div></section>`;
  }
  const mod = BLOCKS.get(section.contentType);
  if (!mod) return html``;
  ctx.usedBlocks.add(mod);
  return html`<section${attrs({
    class: ['section', `${mod.name}-container`, style].filter(Boolean).join(' '),
    'data-section-status': status,
  })}><div class="${mod.name}-wrapper">${blockShell(mod, mod.default(section, ctx))}</div></section>`;
}

function notFoundSection() {
  return html`<section class="section not-found" data-section-status="loaded"><div class="default-content-wrapper"><h1>Page not found</h1><p>The page you asked for isn’t here. It may have moved.</p><p class="button-wrapper"><a class="button secondary" href="/">Go to the home page</a></p></div></section>`;
}
