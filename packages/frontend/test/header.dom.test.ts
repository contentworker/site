import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import header from '../public/blocks/header/header.render.ts';
import { blockCtx, must, settings } from './fixtures.ts';

/** The header's client enhancement against the server's own markup, in jsdom. */
async function mount({ desktop = false } = {}) {
  const dom = new JSDOM(
    `<!doctype html><body><header><div class="header block">${header(settings, blockCtx()).value}</div></header><main><a id="out" href="/x">x</a></main></body>`,
  );
  const { window } = dom;
  window.matchMedia = () =>
    ({ matches: desktop, addEventListener() {} }) as unknown as MediaQueryList;
  Object.assign(globalThis, { window, document: window.document });
  const { default: enhance } = await import(`../public/blocks/header/header.js?${Math.random()}`);
  enhance(must(window.document.querySelector<HTMLElement>('.header')));
  return window;
}

test('server markup works before JS: a <details> toggle and a link list outside it', async () => {
  const window = await mount();
  const doc = window.document;
  assert.ok(doc.querySelector('details.nav-menu > summary[aria-label="Menu"]'));
  assert.equal(doc.querySelector('.nav-sections')?.parentElement?.tagName, 'NAV');
  assert.deepEqual(
    [...doc.querySelectorAll('.nav-sections a')].map((a) => a.getAttribute('href')),
    ['/docs'],
  );
});

test('Escape closes the mobile menu and returns focus to the toggle', async () => {
  const window = await mount();
  const doc = window.document;
  const menu = must(doc.querySelector<HTMLDetailsElement>('details.nav-menu'));
  menu.open = true;
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(menu.open, false);
  assert.equal(doc.activeElement, menu.querySelector('summary'));
});

test('focus leaving the nav closes the mobile menu', async () => {
  const window = await mount();
  const doc = window.document;
  const menu = must(doc.querySelector<HTMLDetailsElement>('details.nav-menu'));
  menu.open = true;
  must(doc.querySelector('.nav')).dispatchEvent(
    new window.FocusEvent('focusout', { relatedTarget: doc.getElementById('out') }),
  );
  assert.equal(menu.open, false);
});
