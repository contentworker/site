import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { defineSite, type Entry } from '../src/index.ts';
import { BLOCKS } from '../src/render/blocks.ts';
import { Site } from '../src/worker.ts';
import { env, fakeDelivery, world } from './fixtures.ts';

const runtime = new URL('..', import.meta.url).pathname;

test('site-level new-block: scaffolds files, src/worker.ts and wrangler.jsonc, and the block renders', async () => {
  // Inside the repo, so the generated `@contentworker/frontend` import resolves.
  const site = join(runtime, '.tmp-site');
  rmSync(site, { recursive: true, force: true });
  mkdirSync(site, { recursive: true });
  writeFileSync(
    join(site, 'wrangler.jsonc'),
    '{\n  "main": "node_modules/@contentworker/frontend/src/entry.ts"\n}\n',
  );
  try {
    const run = spawnSync(
      'node',
      [join(runtime, 'scripts/site-new-block.ts'), 'testimonial', '--js'],
      {
        env: { ...process.env, SITE_ROOT: site },
        encoding: 'utf8',
      },
    );
    assert.equal(run.status, 0, run.stderr);
    for (const f of [
      'blocks/testimonial.render.ts',
      'public/blocks/testimonial/testimonial.css',
      'public/blocks/testimonial/testimonial.js',
      'src/worker.ts',
    ]) {
      assert.ok(existsSync(join(site, f)), f);
    }
    const wrangler = readFileSync(join(site, 'wrangler.jsonc'), 'utf8');
    assert.match(wrangler, /"main": "src\/worker.ts"/);
    assert.match(wrangler, /"assets": \{ "directory": "public", "binding": "ASSETS" \}/);
    // A second run refuses to overwrite.
    assert.notEqual(
      spawnSync('node', [join(runtime, 'scripts/site-new-block.ts'), 'testimonial'], {
        env: { ...process.env, SITE_ROOT: site },
      }).status,
      0,
    );

    const block = await import(join(site, 'blocks/testimonial.render.ts'));
    defineSite({ blocks: [block] });
    const page: Entry = {
      id: 'p-t',
      contentType: 'page',
      fields: {
        title: 'Quotes',
        slug: 'quotes',
        sections: [{ _type: 'testimonial', _key: 'k', heading: 'Loved it', body: null }],
      },
    };
    const e = env({ CONTENTWORKER_DELIVERY: fakeDelivery({ extra: { page: [page] } }) });
    const w = await world(Site, e);
    const res = await defineSite().fetch?.(
      new Request('https://contentworker.site/quotes') as never,
      e as never,
      w.ctx,
    );
    const body = await (res as Response).text();
    await Promise.all(w.ctx.pending);
    assert.match(
      body,
      /<div class="testimonial block" data-block="testimonial" data-block-state="pending"><h2>Loved it<\/h2><\/div>/,
    );
    assert.match(body, /href="\/v\/abc123\/blocks\/testimonial\/testimonial.css"/);
  } finally {
    BLOCKS.delete('testimonial');
    rmSync(site, { recursive: true, force: true });
  }
});
