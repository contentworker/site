import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';

const page = (html: string) => {
  const { window } = new JSDOM(`<!doctype html><body>${html}`);
  Object.assign(globalThis, { window, document: window.document });
  return window.document;
};
// Imported after a window exists: the module reads it at load.
page('');
const { enhanceBlock, enhanceSection } = await import('../public/scripts/enhance.js');
const block = (attrs: string) =>
  `<div class="cards block" data-block="cards" data-block-state="pending" ${attrs}></div>`;

test('a block with no JS or CSS to fetch finishes without a request', async () => {
  const el = page(block('data-block-js="0" data-block-css="0"')).querySelector<HTMLElement>(
    '.block',
  );
  assert.ok(el);
  assert.equal(await enhanceBlock(el), el);
  assert.equal(el.dataset.blockState, 'done');
});

test('a block already done, or not a block, is left alone', async () => {
  const doc = page(
    `<div class="a" data-block="cards" data-block-state="done"></div><div class="b"></div>`,
  );
  const done = doc.querySelector<HTMLElement>('.a');
  const none = doc.querySelector<HTMLElement>('.b');
  assert.ok(done && none);
  await enhanceBlock(done);
  await enhanceBlock(none);
  assert.equal(done.dataset.blockState, 'done');
  assert.equal(none.dataset.blockState, undefined);
});

test('a section enhances its blocks in order, then runs `after`, then is done', async () => {
  const doc = page(
    `<section class="section" data-section-state="pending">${block('data-block-js="0" data-block-css="0"')}</section>`,
  );
  const section = doc.querySelector<HTMLElement>('.section');
  assert.ok(section);
  let during = '';
  await enhanceSection(section, async (s) => {
    during = `${s.dataset.sectionState}/${s.querySelector<HTMLElement>('.block')?.dataset.blockState}`;
  });
  assert.equal(during, 'running/done');
  assert.equal(section.dataset.sectionState, 'done');
});
