import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  blockKeyOf,
  type ContentRef,
  type FieldPath,
  formatContentRef,
  formatFieldPath,
  parseContentRef,
  parseFieldPath,
  topLevelField,
} from '../src/content-ref.ts';

// The examples of @contentworker/sdk's own content-ref tests: the formats must stay identical.
const ref: ContentRef = {
  space: 's1',
  environment: 'main',
  entryId: 'e1',
  contentType: 'article',
  field: 'title',
  locale: 'en-US',
};

test('a ref formats as six URI-encoded parts joined by |, and round-trips', () => {
  assert.equal(formatContentRef(ref), 's1|main|e1|article|title|en-US');
  assert.deepEqual(parseContentRef(formatContentRef(ref)), ref);
});

test('a part containing the separator cannot shift the parts after it', () => {
  const odd = { ...ref, field: 'we|ird' };
  assert.equal(formatContentRef(odd), 's1|main|e1|article|we%7Cird|en-US');
  assert.deepEqual(parseContentRef(formatContentRef(odd)), odd);
});

test('anything that is not a ref parses to undefined', () => {
  assert.equal(parseContentRef(''), undefined);
  assert.equal(parseContentRef(null), undefined);
  assert.equal(parseContentRef('s1|main|e1'), undefined);
  assert.equal(parseContentRef('s1|main|e1|article||en-US'), undefined);
  assert.equal(parseContentRef('s1|main|e1|article|%E0%A4%A|en-US'), undefined);
});

// The SDK's field-path examples (packages/sdk/core/test/content-ref-paths.test.ts).

const base = {
  space: 's1',
  environment: 'main',
  entryId: 'e1',
  contentType: 'landing',
  locale: 'en-US',
} as const;

const paths: [string, FieldPath][] = [
  ['title', { field: 'title', steps: [] }],
  ['body[0192f]', { field: 'body', steps: [{ key: '0192f' }] }],
  ['body[0192f].heading', { field: 'body', steps: [{ key: '0192f' }, { field: 'heading' }] }],
  [
    'body[0192f].ctas[0192e].label',
    {
      field: 'body',
      steps: [{ key: '0192f' }, { field: 'ctas' }, { key: '0192e' }, { field: 'label' }],
    },
  ],
];
for (const [text, path] of paths) {
  test(`field path round-trips ${text}`, () => {
    assert.equal(formatFieldPath(path), text);
    assert.deepEqual(parseFieldPath(text), path);
    const r: ContentRef = { ...base, field: text };
    assert.deepEqual(parseContentRef(formatContentRef(r)), r);
  });
}

test('an old six-part ref still parses; a path ref stays six parts', () => {
  assert.deepEqual(parseContentRef('s1|main|e1|landing|title|en-US'), { ...base, field: 'title' });
  const parts = formatContentRef({ ...base, field: 'body[k1].heading' }).split('|');
  assert.equal(parts.length, 6);
  assert.equal(decodeURIComponent(parts[4] as string), 'body[k1].heading');
});

test('what is not a path is refused, and names that would make one', () => {
  for (const bad of ['', '[k1]', 'body.heading', 'body[k1][k2]', 'body[]', 'body[k1].', 'body[k1'])
    assert.equal(parseFieldPath(bad), undefined, bad);
  assert.throws(() => formatFieldPath({ field: 'a.b', steps: [] }));
  assert.throws(() => formatFieldPath({ field: 'body', steps: [{ key: '' }] }));
});

test('any stored key round-trips, brackets and escapes included', () => {
  for (const key of ['a]b', '[x]', '100%', '%5B', 'a%25]']) {
    const path: FieldPath = { field: 'body', steps: [{ key }, { field: 'heading' }] };
    const text = formatFieldPath(path);
    assert.deepEqual(parseFieldPath(text), path);
    assert.equal(blockKeyOf(formatFieldPath({ field: 'body', steps: [{ key }] })), key);
    const r: ContentRef = { ...base, field: text };
    assert.deepEqual(parseContentRef(formatContentRef(r)), r);
  }
  assert.equal(
    formatFieldPath({ field: 'sections', steps: [{ key: 'a[b]%' }] }),
    'sections[a%5Bb%5D%25]',
  );
});

test('the top-level field and the block a path is in', () => {
  assert.equal(topLevelField('body[k1].ctas[k2].label'), 'body');
  assert.equal(topLevelField('title'), 'title');
  assert.equal(blockKeyOf('body[k1].ctas[k2]'), 'k2');
  assert.equal(blockKeyOf('body[k1].heading'), undefined);
  assert.equal(blockKeyOf('title'), undefined);
});
