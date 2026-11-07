/**
 * Live preview, the page side. Loaded only under /__preview, for the draft, when the admin frames
 * the page with `cw_session` on its URL (src/render/document.ts); public pages never load it.
 *
 * The admin holds the unsaved fields and sends edits by postMessage; `startLivePreview` from
 * `@contentworker/sdk/live-preview` applies them and calls `onChange`, which asks the Worker to
 * re-render with the edited fields (POST /__preview/render) and swaps the result in by
 * `data-cw-block`. The Worker renders with the same block renderers and escaping as any page.
 *
 * STUB: the SDK isn't published yet, so `startLivePreview` below is null and nothing starts. Once
 * it is, serve its browser build next to this file (no bundler: the served file is the source)
 * and replace the stub with:
 *
 *   import { startLivePreview } from './vendor/live-preview.js';
 */
import { loadSection, loadSections } from './lib.js';

/**
 * @typedef {Record<string, Record<string, unknown>>} LiveFields
 * @typedef {{ op: string, key?: string, field: string }} LivePatchOp
 * @typedef {{ entryId: string, contentType: string, locale: string, version: number,
 *   seq: number, ops: readonly LivePatchOp[] }} LivePreviewUpdate
 * @typedef {{ adminOrigin: string,
 *   onChange: (fields: LiveFields, update: LivePreviewUpdate) => void | Promise<void> }} LivePreviewOptions
 * @typedef {{ readonly active: boolean, refresh(): void, destroy(): void }} LivePreview
 */

/** STUB until the SDK is published (see above). @type {((options: LivePreviewOptions) => LivePreview) | null} */
const startLivePreview = null;

/** The next markup `createHTML` may pass: only what render() took from a render response. */
let allowed = '';

/**
 * The Trusted Types policy only live preview pages allow besides the loader's (src/headers.ts).
 * It passes exactly the string `fragment` is about to parse, once, and refuses anything else, so
 * no other script on the page can use it as a way around Trusted Types.
 */
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

/**
 * Parses markup from this origin's render endpoint (escaped there like every page).
 * @param {string} html
 */
function fragment(html) {
  const template = document.createElement('template');
  allowed = html;
  template.innerHTML = /** @type {string} */ (htmlPolicy ? htmlPolicy.createHTML(html) : html);
  allowed = '';
  return template.content;
}

/**
 * Links a stylesheet in <head> once (not inside <main>, which a re-render may replace), and
 * resolves when it has loaded or failed.
 * @param {string} href
 */
function headStylesheet(href) {
  const selector = `link[rel="stylesheet"][href="${CSS.escape(href)}"]`;
  if (document.head.querySelector(selector)) return Promise.resolve();
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

/**
 * Drops stylesheet links <head> already has, so a swapped <main> doesn't repeat them.
 * @param {DocumentFragment} frag
 */
function dropLinked(frag) {
  for (const link of frag.querySelectorAll('link[rel="stylesheet"]')) {
    const href = link.getAttribute('href');
    if (href && document.head.querySelector(`link[rel="stylesheet"][href="${CSS.escape(href)}"]`))
      link.remove();
  }
  return frag;
}

/**
 * Block keys a patch touched, or null when it moved, added or removed blocks, or changed another
 * field: then the whole of <main> is re-rendered.
 * @param {readonly LivePatchOp[]} ops
 */
function touchedKeys(ops) {
  if (!ops.length) return null;
  const keys = new Set();
  for (const op of ops) {
    if (op.op !== 'update' || !op.key || op.field !== 'sections') return null;
    keys.add(op.key);
  }
  return [...keys];
}

let latest = 0;
/** @type {Promise<void>} */
let newest = Promise.resolve();
/** @type {AbortController | undefined} */
let inflight;

/**
 * Re-renders the edited fields through the Worker and puts the result on the page. A newer call
 * aborts an older one, an older response is never drawn over a newer one, and a superseded call
 * settles only when the newest has, so the edit is reported on screen only once it is.
 * @param {LiveFields} fields
 * @param {LivePreviewUpdate} update
 * @returns {Promise<void>}
 */
export function render(fields, update) {
  const seq = ++latest;
  inflight?.abort();
  const controller = new AbortController();
  inflight = controller;
  const stale = () => seq !== latest;
  const run = draw(fields, update, controller.signal, stale).then(
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
 * @param {LiveFields} fields
 * @param {LivePreviewUpdate} update
 * @param {AbortSignal} signal
 * @param {() => boolean} stale
 * @returns {Promise<void>}
 */
async function draw(fields, update, signal, stale) {
  const keys = touchedKeys(update.ops);
  const res = await fetch('/__preview/render', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    // Preview pages send no Referer, which would blank Origin; the Worker checks Origin.
    referrerPolicy: 'same-origin',
    signal,
    body: JSON.stringify({
      entryId: update.entryId,
      locale: update.locale,
      session: new URL(window.location.href).searchParams.get('cw_session'),
      fields,
      ...(keys ? { keys } : {}),
    }),
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
    return;
  }
  const blocks = out.blocks ?? [];
  // The server swaps the first block with a key; a page showing a key twice gets <main> whole.
  const targets = blocks.map(({ key }) =>
    main.querySelectorAll(`[data-cw-block="${CSS.escape(key)}"]`),
  );
  if (targets.some((found) => found.length !== 1))
    return draw(fields, { ...update, ops: [] }, signal, stale);
  for (const [i, { html }] of blocks.entries()) {
    const el = targets[i]?.[0];
    if (!el) continue;
    // A block that now renders to nothing leaves the page.
    const next = html ? dropLinked(fragment(html)).firstElementChild : null;
    if (!(next instanceof HTMLElement)) {
      el.remove();
      continue;
    }
    el.replaceWith(next);
    await loadSection(next);
  }
}

const adminOrigin = document.querySelector('meta[name="cw-admin-origin"]')?.getAttribute('content');
if (adminOrigin && startLivePreview) {
  /** @type {(options: LivePreviewOptions) => LivePreview} */ (startLivePreview)({
    adminOrigin,
    onChange: render,
  });
}
