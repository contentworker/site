import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { call } from './support/preview.ts';

/**
 * Public renders, byte for byte, as the runtime served them before live preview (origin/main at
 * fed43ef): status, every header and the body. Preview work must never change a public page.
 * The footer's year is the only thing normalised. Regenerate this file only for a deliberate
 * public change, and say so in the CHANGELOG.
 */
const golden: Record<string, { status: number; headers: Record<string, string>; body: string }> =
  JSON.parse(readFileSync(new URL('./golden/public-renders.json', import.meta.url), 'utf8'));

for (const [path, want] of Object.entries(golden)) {
  test(`public ${path} is byte-identical to the golden render`, async () => {
    const { res, body: ok } = await call(path, {
      cookie: 'cw_preview=p-inline~pw_good',
      env: { CONTENTWORKER: 'site/main', CONTENTWORKER_PREVIEW: undefined },
    });
    assert.equal(res.status, want.status);
    assert.deepEqual(Object.fromEntries(res.headers), want.headers);
    const body = res.status === 200 ? ok : await res.text();
    assert.equal(body.replace(/© \d{4}/g, '© YEAR'), want.body);
  });
}
