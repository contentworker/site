import assert from 'node:assert/strict';
import { test } from 'node:test';
import { image, shareImageUrl } from '../src/render/image.ts';
import { asset } from './fixtures.ts';

test('the first image in the first section is the eager, high-priority LCP candidate', () => {
  const ctx = { inFirstSection: true, lcpTaken: false };
  const first = image(asset('a'), ctx).value;
  const second = image(asset('b'), ctx).value;
  assert.match(first, /loading="eager" fetchpriority="high"/);
  assert.match(second, /loading="lazy"/);
  assert.doesNotMatch(second, /fetchpriority/);
});

test('below the first section every image is lazy, sized and has a srcset', () => {
  const out = image(asset('a'), { inFirstSection: false }, { sizes: '50vw' }).value;
  assert.match(out, /loading="lazy"/);
  assert.match(out, /decoding="async"/);
  assert.match(out, /width="2400" height="1200"/);
  assert.match(out, /sizes="50vw"/);
  assert.match(out, /srcset="https:\/\/media.example\/a\/w320\/a.jpg 320w, /);
  assert.match(out, /src="https:\/\/media.example\/a\/w960\/a.jpg"/);
  assert.match(out, /style="background-color:#334455"/);
});

test('alt text is escaped and never missing', () => {
  assert.match(image(asset('a', { altText: '"x"' }), {}).value, /alt="&quot;x&quot;"/);
  assert.match(image(asset('a', { altText: null }), {}).value, /alt=""/);
});

test('og image prefers the og rendition', () => {
  assert.equal(shareImageUrl(asset('a')), 'https://media.example/a/r-og/a.jpg');
  assert.equal(
    shareImageUrl(asset('a', { renditions: {} })),
    'https://media.example/a/w1280/a.jpg',
  );
});
