import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assetOrigins, etagFor, tagsFor } from '../src/cache-policy.ts';
import { asset, home, settings } from './fixtures.ts';

test('tags cover every embedded entry and asset, once', () => {
  const tags = tagsFor(home, settings);
  assert.equal(tags[0], 'site');
  assert.equal(new Set(tags).size, tags.length);
  assert.ok(tags.includes('e:a-two'), 'asset embedded in rich text');
});

test('too many references fall back to site + content types', () => {
  const big = {
    id: 'p',
    contentType: 'page',
    fields: {
      items: Array.from({ length: 500 }, (_, i) => ({
        id: `x${i}`,
        contentType: 'card',
        fields: {},
      })),
    },
  };
  assert.deepEqual(tagsFor(big), ['site', 'type:page', 'type:card']);
});

test('the ETag changes with content and with the build', async () => {
  const a = await etagFor('b1', home);
  assert.equal(a, await etagFor('b1', home));
  assert.notEqual(a, await etagFor('b2', home));
  assert.notEqual(a, await etagFor('b1', { ...home, publishedAt: '2027-01-01T00:00:00Z' }));
});

test('asset origins exclude the site itself', () => {
  assert.deepEqual(assetOrigins('https://contentworker.site', home), ['https://media.example']);
  assert.deepEqual(assetOrigins('https://media.example', { a: asset('x') }), []);
});

test('If-None-Match matches weakly: W/ ignored, lists and * understood', async () => {
  const { etagMatches } = await import('../src/cache-policy.ts');
  assert.equal(etagMatches('W/"abc"', '"abc"'), true);
  assert.equal(etagMatches('"abc"', 'W/"abc"'), true);
  assert.equal(etagMatches('"x", W/"abc"', '"abc"'), true);
  assert.equal(etagMatches('*', '"abc"'), true);
  assert.equal(etagMatches('"abd"', '"abc"'), false);
  assert.equal(etagMatches(null, '"abc"'), false);
});
