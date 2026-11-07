import {
  addStylesheet,
  codeRoot,
  enhanceBlock,
  enhanceSection,
  enhanceSections,
  firstImageReady,
} from './enhance.js';

/**
 * Three phases:
 *   critical  the first section's block JS, then wait for the LCP image
 *   deferred  header behaviour, remaining sections, deferred.css, fonts
 *   idle      analytics, consent, third parties: 3 s after load, off the critical path
 * Nothing here builds or reveals content; the HTML arrived finished.
 */

async function startFonts() {
  await addStylesheet(`${codeRoot}/styles/fonts.css`);
  try {
    sessionStorage.setItem('cw-fonts', 'true');
  } catch {
    // storage unavailable: fonts load late on every visit, which is fine
  }
}

/** @param {HTMLElement | null} main */
async function runCritical(main) {
  const first = main?.querySelector('section.section');
  if (first instanceof HTMLElement) await enhanceSection(first, firstImageReady);
  try {
    // Desktop (a proxy for a fast connection) or a repeat visit: fonts can come early.
    if (window.innerWidth >= 900 || sessionStorage.getItem('cw-fonts')) startFonts();
  } catch {
    // ignore
  }
}

/** @param {HTMLElement | null} main */
async function runDeferred(main) {
  /** @type {HTMLElement | null} */
  const header = document.querySelector('body > header .block');
  if (header) enhanceBlock(header);
  if (main) await enhanceSections(main);
  /** @type {HTMLElement | null} */
  const footer = document.querySelector('body > footer .block');
  if (footer) enhanceBlock(footer);
  addStylesheet(`${codeRoot}/styles/deferred.css`);
  startFonts();
}

function runIdle() {
  const start = () => setTimeout(() => import('./idle.js'), 3000);
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
}

async function boot() {
  const main = document.querySelector('main');
  await runCritical(main);
  await runDeferred(main);
  runIdle();
}

boot();
