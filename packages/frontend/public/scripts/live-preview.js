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
import { loadCSS, loadSection, loadSections } from './lib.js';

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

/** The one Trusted Types policy preview pages allow besides the loader's (src/headers.ts). */
const htmlPolicy = /** @type {Window & { trustedTypes?: { createPolicy(name: string,
 *   rules: { createHTML(html: string): string }): { createHTML(html: string): string } } }} */ (
  window
).trustedTypes?.createPolicy('cw-preview', {
  // Markup from this origin's own render endpoint, escaped there like every page; nothing else.
  createHTML: (html) => html,
});

/** @param {string} html */
function fragment(html) {
  const template = document.createElement('template');
  template.innerHTML = /** @type {string} */ (htmlPolicy ? htmlPolicy.createHTML(html) : html);
  return template.content;
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

/**
 * Re-renders the edited fields through the Worker and puts the result on the page.
 * @param {LiveFields} fields
 * @param {LivePreviewUpdate} update
 */
export async function render(fields, update) {
  const keys = touchedKeys(update.ops);
  const res = await fetch('/__preview/render', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    // Preview pages send no Referer, which would blank Origin; the Worker checks Origin.
    referrerPolicy: 'same-origin',
    body: JSON.stringify({
      entryId: update.entryId,
      locale: update.locale,
      fields,
      ...(keys ? { keys } : {}),
    }),
  });
  if (!res.ok) throw new Error(`render failed (${res.status})`);
  /** @type {{ css: string[], main?: string, blocks?: { key: string, html: string }[], missing?: string[] }} */
  const out = await res.json();
  await Promise.all(out.css.map((href) => loadCSS(href)));
  const main = document.querySelector('main');
  if (!main) return;
  // A block the page doesn't show yet: re-render <main> whole instead.
  if (out.missing?.length) return render(fields, { ...update, ops: [] });
  if (out.main !== undefined) {
    main.replaceChildren(fragment(out.main));
    await loadSections(main);
    return;
  }
  for (const { key, html } of out.blocks ?? []) {
    const el = main.querySelector(`[data-cw-block="${CSS.escape(key)}"]`);
    const next = fragment(html).firstElementChild;
    if (!el || !(next instanceof HTMLElement)) continue;
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
