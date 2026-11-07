import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';

type Rules = { createHTML(html: string): string };
type Render = (fields: unknown, update: unknown) => Promise<void>;

const section = (key: string, text: string) =>
  `<section class="section hero-container" data-section-status="initialized" data-cw-block="${key}"><p>${text}</p></section>`;

/**
 * The live preview script in jsdom, with fetch answered by `answer` (in call order) and a
 * Trusted Types stand-in that records the policy the script creates.
 */
async function mount(
  main: string,
  answer: (body: Record<string, unknown>, n: number) => Promise<unknown>,
) {
  const dom = new JSDOM(
    `<!doctype html><head><link rel="stylesheet" href="/v/b/blocks/hero/hero.css"></head><body><main id="main" data-cw-slot="sections">${main}</main></body>`,
  );
  const { window } = dom;
  let rules: Rules | undefined;
  Object.assign(window, {
    trustedTypes: {
      createPolicy: (_name: string, r: Rules) => {
        rules = r;
        return r;
      },
    },
  });
  const requests: Record<string, unknown>[] = [];
  Object.assign(globalThis, {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    CSS: { escape: (s: string) => s },
    fetch: async (_to: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      requests.push(body);
      const json = await answer(body, requests.length);
      return { ok: true, status: 200, json: async () => json };
    },
  });
  const mod = (await import(`../public/scripts/live-preview.js?${Math.random()}`)) as {
    render: Render;
  };
  return { window, doc: window.document, render: mod.render, requests, rules: () => rules };
}

const update = (ops: unknown[] = []) => ({
  entryId: 'p-inline',
  contentType: 'page',
  locale: 'en-US',
  version: 1,
  seq: 1,
  ops,
});
const touch = (key: string) => update([{ op: 'update', key, field: 'sections', locale: 'en-US' }]);

test('an older response never draws over a newer one, and settles only after it', async () => {
  let release: () => void = () => {};
  const slow = new Promise<void>((r) => (release = r));
  const { doc, render } = await mount(section('k-a', 'old'), async (_b, n) => {
    if (n === 1) await slow;
    return {
      blocks: [{ key: 'k-a', html: section('k-a', n === 1 ? 'first' : 'second') }],
      css: [],
    };
  });
  const order: string[] = [];
  const first = render({}, touch('k-a')).then(() => order.push('first'));
  const second = render({}, touch('k-a')).then(() => order.push('second'));
  await second;
  release();
  await first;
  assert.match(doc.querySelector('main')?.innerHTML ?? '', /second/);
  assert.doesNotMatch(doc.querySelector('main')?.innerHTML ?? '', /first/);
  assert.deepEqual(order, ['second', 'first']);
});

test('swaps one block, removes a block that renders to nothing, and re-renders <main> for a duplicate key', async () => {
  const { doc, render, requests } = await mount(
    section('k-a', 'a') + section('k-b', 'b') + section('k-b', 'b again'),
    async (body) =>
      body.keys
        ? {
            blocks: (body.keys as string[]).map((key) => ({
              key,
              html: key === 'k-a' ? section('k-a', 'A!') : '',
            })),
            css: [],
          }
        : { main: section('k-a', 'whole'), css: [] },
  );
  await render({}, touch('k-a'));
  assert.match(doc.querySelector('[data-cw-block="k-a"]')?.textContent ?? '', /A!/);
  await render({}, touch('k-b'));
  assert.equal(requests.at(-1)?.keys, undefined, 'k-b is on the page twice: whole <main>');
  assert.equal(
    doc.querySelector('main')?.innerHTML,
    section('k-a', 'whole').replace('initialized', 'loaded'),
  );
});

test('a block re-rendered to nothing leaves the page', async () => {
  const { doc, render } = await mount(section('k-a', 'a') + section('k-b', 'b'), async () => ({
    blocks: [{ key: 'k-b', html: '' }],
    css: [],
  }));
  await render({}, touch('k-b'));
  assert.equal(doc.querySelector('[data-cw-block="k-b"]'), null);
  assert.ok(doc.querySelector('[data-cw-block="k-a"]'));
});

test('a whole-<main> swap keeps stylesheets in <head>, once', async () => {
  const { doc, render, window } = await mount(section('k-a', 'a'), async () => ({
    main: `<link rel="stylesheet" href="/v/b/blocks/hero/hero.css">${section('k-a', 'x')}<link rel="stylesheet" href="/v/b/blocks/faq/faq.css">${section('k-f', 'f')}`,
    css: ['/v/b/blocks/hero/hero.css', '/v/b/blocks/faq/faq.css'],
  }));
  const done = render({}, update());
  // The new stylesheet goes to <head>; fire its load so the render can go on.
  await new Promise((r) => setTimeout(r, 0));
  for (const link of doc.head.querySelectorAll('link'))
    link.dispatchEvent(new window.Event('load'));
  await done;
  assert.deepEqual(
    [...doc.head.querySelectorAll('link')].map((l) => l.getAttribute('href')),
    ['/v/b/blocks/hero/hero.css', '/v/b/blocks/faq/faq.css'],
  );
  assert.equal(doc.querySelector('main')?.querySelectorAll('link').length, 0);
});

test('the cw-preview policy passes only the markup a render response brought', async () => {
  const { rules, render } = await mount(section('k-a', 'a'), async () => ({
    blocks: [{ key: 'k-a', html: section('k-a', 'ok') }],
    css: [],
  }));
  const policy = rules();
  assert.ok(policy);
  assert.throws(() => policy.createHTML('<img src=x onerror=alert(1)>'), /render responses only/);
  await render({}, touch('k-a'));
  assert.throws(
    () => policy.createHTML(section('k-a', 'ok')),
    /render responses only/,
    'used once',
  );
});
