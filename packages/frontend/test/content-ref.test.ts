import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type ContentRef, formatContentRef, parseContentRef } from '../src/content-ref.ts';

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
