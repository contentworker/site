/**
 * Browser-side enhancement. The page is complete before any of this runs: these functions only
 * add optional block JS and late CSS.
 */

/** The versioned code root (/v/<build>), derived from this module's own URL. */
export const codeRoot = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

/**
 * Adds a stylesheet once. Resolves when it has loaded (or failed: a missing style must not block).
 * @param {string} href
 */
export function addStylesheet(href) {
  return /** @type {Promise<void>} */ (
    new Promise((resolve) => {
      if (document.querySelector(`link[rel="stylesheet"][href="${CSS.escape(href)}"]`)) {
        resolve();
        return;
      }
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.onload = () => resolve();
      link.onerror = () => resolve();
      document.head.append(link);
    })
  );
}

// Trusted Types: the CSP requires them for script sinks. Only same-origin scripts may load.
/**
 * @typedef {{ createScriptURL(url: string): string }} ScriptPolicy
 * @typedef {{ createPolicy(name: string, rules: { createScriptURL(url: string): string }): ScriptPolicy }} TrustedTypes
 */
/** @type {ScriptPolicy | undefined} */
const scriptPolicy = /** @type {Window & { trustedTypes?: TrustedTypes }} */ (
  window
).trustedTypes?.createPolicy('loader', {
  /** @param {string} url */
  createScriptURL: (url) => {
    const parsed = new URL(url, window.location.href);
    if (parsed.origin !== window.location.origin) throw new TypeError(`blocked script ${url}`);
    return parsed.href;
  },
});

/**
 * Loads a classic (non-module) same-origin script once, for third parties that ship one.
 * @param {string} src
 * @param {Record<string, string>} [attrs]
 */
export function addScript(src, attrs = {}) {
  return /** @type {Promise<void>} */ (
    new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${CSS.escape(src)}"]`)) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = scriptPolicy ? scriptPolicy.createScriptURL(src) : src;
      for (const [k, v] of Object.entries(attrs)) script.setAttribute(k, v);
      script.onload = () => resolve();
      script.onerror = reject;
      document.head.append(script);
    })
  );
}

/**
 * Runs a block's client enhancement, if it has one. Blocks the Worker marks `data-block-js="0"`
 * cost no request. CSS is normally linked by the Worker already; this covers blocks added later.
 * @param {HTMLElement} block
 */
export async function enhanceBlock(block) {
  const { block: name, blockState, blockJs, blockCss } = block.dataset;
  if (!name || blockState === 'running' || blockState === 'done') return block;
  block.dataset.blockState = 'running';
  try {
    const base = `${codeRoot}/blocks/${name}/${name}`;
    const css = blockCss === '0' ? Promise.resolve() : addStylesheet(`${base}.css`);
    const js =
      blockJs === '0'
        ? Promise.resolve()
        : import(`${base}.js`).then((mod) => mod.default?.(block));
    await Promise.all([css, js]);
  } catch (error) {
    console.error(`block ${name} failed to load`, error);
  }
  block.dataset.blockState = 'done';
  return block;
}

/**
 * Enhances every block in a section, in order.
 * @param {HTMLElement} section
 * @param {(section: HTMLElement) => Promise<void>} [after]
 */
export async function enhanceSection(section, after) {
  if (!section || (section.dataset.sectionState && section.dataset.sectionState !== 'pending'))
    return;
  section.dataset.sectionState = 'running';
  for (const block of section.querySelectorAll(/** @type {'div'} */ ('.block[data-block]'))) {
    await enhanceBlock(block);
  }
  if (after) await after(section);
  section.dataset.sectionState = 'done';
}

/** @param {ParentNode} root */
export async function enhanceSections(root) {
  for (const section of root.querySelectorAll(/** @type {'section'} */ ('.section'))) {
    await enhanceSection(section);
  }
}

/**
 * Waits for the section's first image. The Worker already marked it high priority in the HTML;
 * this only holds the deferred phase back until the LCP image is in.
 * @param {HTMLElement} section
 */
export function firstImageReady(section) {
  const img = section.querySelector('img');
  if (!img || img.complete) return Promise.resolve();
  return new Promise((resolve) => {
    img.addEventListener('load', resolve, { once: true });
    img.addEventListener('error', resolve, { once: true });
  });
}
