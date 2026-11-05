import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CONTENT_TYPES, type FieldDef, VARIANTS } from '../content-model/model.ts';
import { BLOCKS } from '../src/render/blocks.ts';
import { DEFAULT_ROUTES } from '../src/routes.ts';

const type = (apiId: string) => CONTENT_TYPES.find((t) => t.apiId === apiId);

test('every page block has a variant, and every variant renders through a block', () => {
  const variants = new Set((VARIANTS ?? []).map((v) => v.apiId));
  const blocks = [...BLOCKS.keys()].filter((k) => k !== 'articleList'); // listings aren't authored
  for (const b of blocks) assert.ok(variants.has(b), `no "${b}" variant for block ${b}`);
  for (const v of variants)
    assert.ok(v === 'richText' || BLOCKS.has(v), `variant "${v}" has no block`);
});

test('URL patterns match the runtime’s default routes (so slug changes redirect correctly)', () => {
  for (const r of DEFAULT_ROUTES) {
    if (!('contentType' in r)) continue;
    assert.equal(type(r.contentType)?.urlPattern, r.path.replace(':slug', '{slug}'), r.contentType);
  }
});

test('the model keeps ContentWorker’s rules', () => {
  const walk = (fields: FieldDef[], depth: number, nested: boolean) => {
    assert.ok(depth <= 3, 'components nest at most 3 deep');
    fields.forEach((f, i) => {
      assert.equal(f.position, i);
      if (nested) {
        assert.equal(f.localized, false, `${f.apiId}: nested fields aren't localized`);
        assert.notEqual(f.type, 'Slug', `${f.apiId}: no Slug inside a component`);
        assert.ok(!f.unique, `${f.apiId}: no unique inside a component`);
      }
      if (f.fields) walk(f.fields, depth + 1, true);
      if (f.items?.fields) walk(f.items.fields, depth + 1, true);
      for (const v of f.items?.variants ?? []) walk(v.fields, depth + 1, true);
    });
  };
  for (const t of CONTENT_TYPES) {
    assert.ok(
      t.fields.some((f) => f.apiId === t.displayField),
      `${t.apiId}: displayField`,
    );
    walk(t.fields, 0, false);
  }
});
