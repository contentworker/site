#!/usr/bin/env node
// npm run new-block <name> [-- --js]  (Node runs this TypeScript file directly: type stripping)
// Scaffolds public/blocks/<name>/ (server render, CSS, optional client JS), a test, and registers
// the block in src/render/blocks.ts. Then: add a <contentType> content type in ContentWorker.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const name = process.argv[2] ?? '';
const withJs = process.argv.includes('--js');
if (!name || !/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name)) {
  console.error('Usage: npm run new-block <kebab-case-name> [-- --js]');
  process.exit(1);
}
const contentType = name.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
const ident = contentType;
const dir = join(root, 'public/blocks', name);
if (existsSync(dir)) {
  console.error(`public/blocks/${name} already exists`);
  process.exit(1);
}
mkdirSync(dir, { recursive: true });

writeFileSync(
  join(dir, `${name}.render.ts`),
  `import { html, type Safe } from '../../../src/html.ts';
import type { Entry, RenderCtx } from '../../../src/types.ts';

/**
 * ${name}: describe what it shows. Fields: heading (Symbol), body (RichText).
 * The HTML is final: ${withJs ? `${name}.js adds behaviour only, never moves or removes content.` : 'no client JS.'}
 */
export const name = '${name}';
export const contentType = '${contentType}';
export const css = true;
export const js = ${withJs};

export default function render(entry: Entry, ctx: RenderCtx): Safe {
  const { heading, body } = entry.fields;
  ctx.headingLevel = 2;
  return html\`\${heading ? html\`<h2>\${heading}</h2>\` : ''}\${body ? ctx.richText(body) : ''}\`;
}
`,
);
writeFileSync(
  join(dir, `${name}.css`),
  `/* ${name}: budget 3 KB gzip (budgets.json). */
.${name} {
  display: block;
}
`,
);
if (withJs) {
  writeFileSync(
    join(dir, `${name}.js`),
    `/**
 * Enhances a server-rendered ${name} block. Add listeners and ARIA state; never move, hide or
 * remove server content. Budget: 4 KB gzip.
 * @param {HTMLElement} block
 */
export default function decorate(block) {
  block.dataset.enhanced = 'true';
}
`,
  );
}
mkdirSync(join(root, 'test/blocks'), { recursive: true });
writeFileSync(
  join(root, 'test/blocks', `${name}.test.ts`),
  `import assert from 'node:assert/strict';
import { test } from 'node:test';
import render from '../../public/blocks/${name}/${name}.render.ts';
import { blockCtx, doc, p, text } from '../fixtures.ts';

test('${name} renders its heading and body', () => {
  const out = render({ id: 'x', contentType: '${contentType}', fields: { heading: 'Hello', body: doc(p(text('World'))) } }, blockCtx()).value;
  assert.equal(out, '<h2>Hello</h2><p>World</p>');
});
`,
);

const registry = join(root, 'src/render/blocks.ts');
let src = readFileSync(registry, 'utf8');
src = src.replace(
  '// new-block:imports (scripts/new-block.mjs adds lines below)\n',
  `// new-block:imports (scripts/new-block.mjs adds lines below)\nimport * as ${ident} from '../../public/blocks/${name}/${name}.render.ts';\n`,
);
src = src.replace('  // new-block:modules\n', `  // new-block:modules\n  ${ident},\n`);
writeFileSync(registry, src);

console.log(`Created public/blocks/${name}/ and test/blocks/${name}.test.ts; registered "${contentType}".
Next: add the "${contentType}" content type in ContentWorker (fields: heading, body), then npm run check.`);
