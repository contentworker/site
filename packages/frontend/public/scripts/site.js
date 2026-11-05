import {
  codeBasePath,
  loadBlock,
  loadCSS,
  loadSection,
  loadSections,
  waitForFirstImage,
} from './lib.js';

/**
 * Three phases:
 *   eager    the first section's block JS, then wait for the LCP image
 *   lazy     header behaviour, remaining sections, lazy.css, fonts
 *   delayed  analytics, consent, third parties: 3 s after load, off the critical path
 * Nothing here builds or reveals content; the HTML arrived finished.
 */

async function loadFonts() {
  await loadCSS(`${codeBasePath}/styles/fonts.css`);
  try {
    sessionStorage.setItem('fonts-loaded', 'true');
  } catch {
    // storage unavailable: fonts load late on every visit, which is fine
  }
}

/** @param {HTMLElement | null} main */
async function loadEager(main) {
  const first = main?.querySelector('section.section');
  if (first instanceof HTMLElement) await loadSection(first, waitForFirstImage);
  try {
    // Desktop (a proxy for a fast connection) or a repeat visit: fonts can come early.
    if (window.innerWidth >= 900 || sessionStorage.getItem('fonts-loaded')) loadFonts();
  } catch {
    // ignore
  }
}

/** @param {HTMLElement | null} main */
async function loadLazy(main) {
  /** @type {HTMLElement | null} */
  const header = document.querySelector('body > header .block');
  if (header) loadBlock(header);
  if (main) await loadSections(main);
  /** @type {HTMLElement | null} */
  const footer = document.querySelector('body > footer .block');
  if (footer) loadBlock(footer);
  loadCSS(`${codeBasePath}/styles/lazy.css`);
  loadFonts();
}

function loadDelayed() {
  const start = () => setTimeout(() => import('./delayed.js'), 3000);
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
}

async function loadPage() {
  const main = document.querySelector('main');
  await loadEager(main);
  await loadLazy(main);
  loadDelayed();
}

loadPage();
