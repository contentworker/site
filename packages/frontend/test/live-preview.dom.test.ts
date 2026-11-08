import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { formatContentRef, formatFieldPath } from '../src/content-ref.ts';

type Rules = { createHTML(html: string): string };
type View = {
  rev: number;
  withProposals: Record<string, unknown>;
  ghosts: { inserted: string[]; changed: string[]; removed: string[] };
};
type OnState = (entryId: string, locale: string, fields: unknown, view: View) => Promise<void>;

const ref = (key: string) =>
  formatContentRef({
    space: 'site',
    environment: 'main',
    entryId: 'p-inline',
    contentType: 'page',
    field: formatFieldPath({ field: 'sections', steps: [{ key }] }),
    locale: 'en-US',
  });
const section = (key: string, text: string) =>
  `<section class="section cta-container" data-section-status="initialized" data-cw-ref="${ref(key)}"><p>${text}</p></section>`;
const block = (key: string, heading: string) => ({ _type: 'cta', _key: key, heading });
const view = (sections: unknown[], ghosts: Partial<View['ghosts']> = {}): View => ({
  rev: 1,
  withProposals: { title: 'T', sections },
  ghosts: { inserted: [], changed: [], removed: [], ...ghosts },
});

/** The live preview script in jsdom, fetch answered by `answer` in call order. */
async function mount(
  main: string,
  answer: (body: Record<string, unknown>, n: number) => Promise<unknown>,
) {
  const dom = new JSDOM(
    `<!doctype html><head><link rel="stylesheet" href="/v/b/blocks/cta/cta.css"></head><body><main id="main">${main}</main></body>`,
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
    onState: OnState;
    blockKeyOfRef: (ref: string | null) => string | undefined;
  };
  const doc = window.document;
  const html = () => doc.querySelector('main')?.innerHTML ?? '';
  return { window, doc, html, ...mod, requests, rules: () => rules };
}

/** Answers a whole-<main> render from the request's sections, or the requested blocks. */
const echo = async (body: Record<string, unknown>) => {
  const sections = (body.fields as { sections: { _key: string; heading: string }[] }).sections;
  const keys = (body.refs as string[] | undefined)?.map(
    (r) => /sections%5B(.*)%5D/.exec(r)?.[1] ?? '',
  );
  if (!keys) return { main: sections.map((s) => section(s._key, s.heading)).join(''), css: [] };
  return {
    blocks: keys.map((key) => {
      const s = sections.find((x) => x._key === key);
      return { key, ref: ref(key), html: s?.heading ? section(key, s.heading) : '' };
    }),
    css: [],
  };
};

test("reads a block's key from its ref, escapes undone", async () => {
  const { blockKeyOfRef } = await mount('', echo);
  assert.equal(blockKeyOfRef(ref('k-a')), 'k-a');
  assert.equal(blockKeyOfRef(ref('a[b]%')), 'a[b]%');
  assert.equal(
    blockKeyOfRef(
      formatContentRef({
        space: 's',
        environment: 'e',
        entryId: 'x',
        contentType: 'page',
        field: 'sections[k].heading',
        locale: 'en-US',
      }),
    ),
    undefined,
  );
  assert.equal(blockKeyOfRef('nope'), undefined);
});

test('the first state renders <main> whole; then only the blocks that changed', async () => {
  const { onState, requests, html } = await mount(section('k-a', 'a') + section('k-b', 'b'), echo);
  await onState('p-inline', 'en-US', {}, view([block('k-a', 'a'), block('k-b', 'b')]));
  assert.equal(requests[0]?.refs, undefined);
  assert.equal(requests[0]?.locale, 'en-US');
  await onState('p-inline', 'en-US', {}, view([block('k-a', 'a'), block('k-b', 'B!')]));
  assert.deepEqual(requests[1]?.refs, [ref('k-b')]);
  assert.match(html(), /<p>B!<\/p>/);
  // A reorder (or another field) re-renders <main> whole.
  await onState('p-inline', 'en-US', {}, view([block('k-b', 'B!'), block('k-a', 'a')]));
  assert.equal(requests[2]?.refs, undefined);
});

test('an older response never draws over a newer one, and settles only after it', async () => {
  let release: () => void = () => {};
  const slow = new Promise<void>((r) => {
    release = r;
  });
  const { onState, html } = await mount(section('k-a', 'old'), async (body, n) => {
    if (n === 1) await slow;
    return echo(body);
  });
  const order: string[] = [];
  const first = onState('p-inline', 'en-US', {}, view([block('k-a', 'first')])).then(() =>
    order.push('first'),
  );
  const second = onState('p-inline', 'en-US', {}, view([block('k-a', 'second')])).then(() =>
    order.push('second'),
  );
  await second;
  release();
  await first;
  assert.match(html(), /second/);
  assert.doesNotMatch(html(), /first/);
  assert.deepEqual(order, ['second', 'first']);
});

test('a block re-rendered to nothing leaves the page; a key shown twice re-renders <main>', async () => {
  const { onState, doc, requests } = await mount(section('k-a', 'a') + section('k-b', 'b'), echo);
  await onState('p-inline', 'en-US', {}, view([block('k-a', 'a'), block('k-b', 'b')]));
  await onState('p-inline', 'en-US', {}, view([block('k-a', 'a'), block('k-b', '')]));
  assert.equal(doc.querySelector(`[data-cw-ref="${ref('k-b')}"]`), null);
  assert.ok(doc.querySelector(`[data-cw-ref="${ref('k-a')}"]`));

  const twice = await mount('', echo);
  await twice.onState('p-inline', 'en-US', {}, view([block('k-a', 'a'), block('k-c', 'c')]));
  // Something on the page (a site script, say) shows the block twice: don't guess which.
  twice.doc.querySelector('main')?.insertAdjacentHTML('beforeend', section('k-a', 'copy'));
  await twice.onState('p-inline', 'en-US', {}, view([block('k-a', 'A'), block('k-c', 'c')]));
  assert.equal(twice.requests.at(-1)?.refs, undefined);
  assert.equal(requests.length, 2);
});

test("Coworker's proposals render as ghosts, and only proposals do", async () => {
  const { onState, doc, requests } = await mount('', echo);
  const sections = [block('k-a', 'a'), block('k-new', 'proposed'), block('k-old', 'going')];
  await onState(
    'p-inline',
    'en-US',
    {},
    view(sections, { inserted: ['k-new'], removed: ['k-old'] }),
  );
  const ghost = (key: string) =>
    doc.querySelector(`[data-cw-ref="${ref(key)}"]`)?.getAttribute('data-cw-ghost') ?? null;
  assert.equal(ghost('k-new'), 'inserted');
  assert.equal(ghost('k-old'), 'removed');
  assert.equal(ghost('k-a'), null);
  // Ghosts changing alone re-marks without a render.
  await onState('p-inline', 'en-US', {}, view(sections, { changed: ['k-a'] }));
  assert.equal(requests.length, 1);
  assert.equal(ghost('k-a'), 'changed');
  assert.equal(ghost('k-new'), null);
});

test('a whole-<main> swap keeps stylesheets in <head>, once', async () => {
  const { doc, onState, window } = await mount(section('k-a', 'a'), async () => ({
    main: `<link rel="stylesheet" href="/v/b/blocks/cta/cta.css">${section('k-a', 'x')}<link rel="stylesheet" href="/v/b/blocks/faq/faq.css">${section('k-f', 'f')}`,
    css: ['/v/b/blocks/cta/cta.css', '/v/b/blocks/faq/faq.css'],
  }));
  const done = onState('p-inline', 'en-US', {}, view([block('k-a', 'x'), block('k-f', 'f')]));
  await new Promise((r) => setTimeout(r, 0));
  for (const link of doc.head.querySelectorAll('link'))
    link.dispatchEvent(new window.Event('load'));
  await done;
  assert.deepEqual(
    [...doc.head.querySelectorAll('link')].map((l) => l.getAttribute('href')),
    ['/v/b/blocks/cta/cta.css', '/v/b/blocks/faq/faq.css'],
  );
  assert.equal(doc.querySelector('main')?.querySelectorAll('link').length, 0);
});

test('the cw-preview policy passes only the markup a render response brought', async () => {
  const { rules, onState } = await mount(section('k-a', 'a'), echo);
  const policy = rules();
  assert.ok(policy);
  assert.throws(() => policy.createHTML('<img src=x onerror=alert(1)>'), /render responses only/);
  await onState('p-inline', 'en-US', {}, view([block('k-a', 'ok')]));
  assert.throws(
    () => policy.createHTML(section('k-a', 'ok')),
    /render responses only/,
    'used once',
  );
});
