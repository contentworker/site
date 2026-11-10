/**
 * Live preview, the page side. Loaded only on /__preview pages showing a draft; `connectPreview`
 * (the vendored @contentworker/sdk/live-preview, scripts/embed-assets.ts) connects only when the
 * admin frames the page. `onState` re-renders through POST /__preview/render and swaps blocks by
 * their `data-cw-ref`; `view.ghosts` get `data-cw-ghost` (styles/preview.css).
 */
import { loadSection, loadSections } from './lib.js';
import { connectPreview, PAGE_REPORT_LIMIT } from './vendor/sdk/live-preview.js';

/**
 * @typedef {import('./vendor/sdk/live-preview.js').Capability} Capability
 * @typedef {import('./vendor/sdk/live-preview.js').LiveFields} LiveFields
 * @typedef {import('./vendor/sdk/live-preview.js').LiveView} LiveView
 */

/** @type {Capability[]} */
const CAPABILITIES = ['select', 'patch.fields', 'patch.blocks', 'proposals', 'scroll', 'layout'];

/** The one string `cw-preview` will pass next: a render response's markup, once. */
let allowed = '';

const htmlPolicy = /** @type {Window & { trustedTypes?: { createPolicy(name: string,
 *   rules: { createHTML(html: string): string }): { createHTML(html: string): string } } }} */ (
  window
).trustedTypes?.createPolicy('cw-preview', {
  createHTML: (html) => {
    if (!allowed || html !== allowed) throw new TypeError('cw-preview: render responses only');
    allowed = '';
    return html;
  },
});

/** @param {string} html markup from this origin's render endpoint */
function fragment(html) {
  const template = document.createElement('template');
  allowed = html;
  template.innerHTML = /** @type {string} */ (htmlPolicy ? htmlPolicy.createHTML(html) : html);
  allowed = '';
  return template.content;
}

/** @param {string} href */
const linkSelector = (href) => `link[rel="stylesheet"][href="${CSS.escape(href)}"]`;

/** Links a stylesheet in <head> once (never in <main>, which a re-render replaces). @param {string} href */
function headStylesheet(href) {
  if (document.head.querySelector(linkSelector(href))) return Promise.resolve();
  return /** @type {Promise<void>} */ (
    new Promise((resolve) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.onload = () => resolve();
      link.onerror = () => resolve();
      document.head.append(link);
    })
  );
}

/** Drops stylesheet links <head> already has. @param {DocumentFragment} frag */
function dropLinked(frag) {
  for (const link of frag.querySelectorAll('link[rel="stylesheet"]')) {
    const href = link.getAttribute('href');
    if (href && document.head.querySelector(linkSelector(href))) link.remove();
  }
  return frag;
}

/** The `_key` a `sections[<key>]` ref names, escapes undone, else undefined. @param {string | null} ref */
export function blockKeyOfRef(ref) {
  const parts = (ref ?? '').split('|');
  if (parts.length !== 6) return undefined;
  let field;
  try {
    field = decodeURIComponent(parts[4] ?? '');
  } catch {
    return undefined;
  }
  const m = /^sections\[([^[\]]+)\]$/.exec(field);
  return m?.[1]?.replace(/%5B/gi, '[').replace(/%5D/gi, ']').replace(/%25/g, '%');
}

/** Block elements by key (every element, so a caller can refuse to guess). @param {ParentNode} root */
function blocksOn(root) {
  /** @type {Map<string, { el: Element, ref: string }[]>} */
  const out = new Map();
  for (const el of root.querySelectorAll('[data-cw-ref]')) {
    const ref = el.getAttribute('data-cw-ref') ?? '';
    const key = blockKeyOfRef(ref);
    if (key) out.set(key, [...(out.get(key) ?? []), { el, ref }]);
  }
  return out;
}

/** @param {unknown} a @param {unknown} b */
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Refs of the blocks to re-render, or null for all of <main> (another field, or the blocks or
 * their order changed). @param {LiveFields | undefined} before @param {LiveFields} after
 */
function changedBlocks(before, after) {
  if (!before) return null;
  const { sections: was, ...restWas } = before;
  const { sections: now, ...restNow } = after;
  if (!same(restWas, restNow) || !Array.isArray(was) || !Array.isArray(now)) return null;
  /** @param {unknown} b */
  const keyOf = (b) => /** @type {{ _key?: unknown }} */ (b)?._key;
  if (!same(was.map(keyOf), now.map(keyOf))) return null;
  const keys = now.filter((b, i) => !same(b, was[i])).map(keyOf);
  if (keys.some((k) => typeof k !== 'string')) return null;
  const onPage = blocksOn(document);
  /** @type {string[]} */
  const refs = [];
  for (const key of /** @type {string[]} */ (keys)) {
    const found = onPage.get(key);
    if (found?.length !== 1 || !found[0]) return null;
    refs.push(found[0].ref);
  }
  return refs;
}

/** @param {LiveView['ghosts']} ghosts */
function markGhosts(ghosts) {
  for (const el of document.querySelectorAll('[data-cw-ghost]'))
    el.removeAttribute('data-cw-ghost');
  const onPage = blocksOn(document);
  for (const kind of /** @type {const} */ (['inserted', 'changed', 'removed'])) {
    for (const key of ghosts[kind]) {
      for (const { el } of onPage.get(key) ?? []) el.setAttribute('data-cw-ghost', kind);
    }
  }
}

let latest = 0;
/** @type {Promise<void>} */
let newest = Promise.resolve();
/** @type {AbortController | undefined} */
let inflight;
/** The fields last put on screen. @type {LiveFields | undefined} */
let shown;

/**
 * `onState`. A newer call aborts an older one, which is never drawn and settles only after the
 * newest, so `applied` means on screen.
 * @param {string} entryId
 * @param {string} locale
 * @param {LiveFields} _fields
 * @param {LiveView} view
 * @returns {Promise<void>}
 */
export function onState(entryId, locale, _fields, view) {
  const seq = ++latest;
  inflight?.abort();
  const controller = new AbortController();
  inflight = controller;
  const stale = () => seq !== latest;
  const run = draw(entryId, locale, view, controller.signal, stale).then(
    () => (stale() ? newest : undefined),
    (error) => {
      if (stale()) return newest;
      throw error;
    },
  );
  newest = run;
  return run;
}

/**
 * @param {string} entryId
 * @param {string} locale
 * @param {LiveView} view
 * @param {AbortSignal} signal
 * @param {() => boolean} stale
 * @param {boolean} [whole]
 * @returns {Promise<void>}
 */
async function draw(entryId, locale, view, signal, stale, whole = false) {
  const fields = view.withProposals;
  const refs = whole ? null : changedBlocks(shown, fields);
  if (refs && refs.length === 0) {
    markGhosts(view.ghosts);
    shown = fields;
    return;
  }
  const res = await fetch('/__preview/render', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    // Preview pages send no Referer, which would blank Origin; the Worker checks Origin.
    referrerPolicy: 'same-origin',
    signal,
    body: JSON.stringify({ entryId, locale, fields, ...(refs ? { refs } : {}) }),
  });
  if (!res.ok) throw new Error(`render failed (${res.status})`);
  /** @type {{ css: string[], main?: string, blocks?: { key: string, html: string }[] }} */
  const out = await res.json();
  await Promise.all(out.css.map(headStylesheet));
  const main = document.querySelector('main');
  if (stale() || !main) return;
  if (out.main !== undefined) {
    main.replaceChildren(dropLinked(fragment(out.main)));
    await loadSections(main);
  } else {
    const onPage = blocksOn(main);
    for (const { key, html } of out.blocks ?? []) {
      const found = onPage.get(key);
      if (found?.length !== 1 || !found[0]) return draw(entryId, locale, view, signal, stale, true);
      // A block that now renders to nothing leaves the page.
      const next = html ? dropLinked(fragment(html)).firstElementChild : null;
      if (!(next instanceof HTMLElement)) {
        found[0].el.remove();
        continue;
      }
      found[0].el.replaceWith(next);
      await loadSection(next);
    }
  }
  markGhosts(view.ghosts);
  shown = fields;
}

/** Forgets what is on screen, so the next state re-renders <main> whole (a new session). */
export function reset() {
  latest += 1;
  inflight?.abort();
  shown = undefined;
}

const adminOrigin = document.querySelector('meta[name="cw-admin-origin"]')?.getAttribute('content');
const entryMeta = document.querySelector('meta[name="cw-entry"]');
const entry = {
  entryId: entryMeta?.getAttribute('content') ?? '',
  contentType: entryMeta?.getAttribute('data-content-type') ?? '',
  locale: entryMeta?.getAttribute('data-locale') ?? '',
};
if (adminOrigin && entry.entryId) {
  const preview = connectPreview({
    adminOrigin,
    capabilities: CAPABILITIES,
    onState(entryId, locale, fields, view) {
      if (entryId !== entry.entryId) return;
      return onState(entryId, locale, fields, view);
    },
  });
  if (preview.active) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('../styles/preview.css', import.meta.url).pathname;
    document.head.append(link);
    // The edited entry first; the admin reads at most PAGE_REPORT_LIMIT.
    const entries = [entry].slice(0, PAGE_REPORT_LIMIT);
    preview.on('connect', () => preview.emit('page', { url: window.location.href, entries }));
    // A new session starts from a fresh entry.state: nothing on screen counts as rendered.
    preview.on('disconnect', reset);
  }
}
