#!/usr/bin/env node
// Adds a block to a SITE (not to the runtime):
//   npm run new-block -- <name> [--js]          (from the site's root)
// Creates blocks/<name>.render.ts (server half) and public/blocks/<name>/<name>.css (+ .js),
// registers the block in src/worker.ts (creating it on first use), and points wrangler.jsonc at it
// with an assets binding, so the two-file site grows only the files it needs.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const site = process.env.SITE_ROOT ?? process.cwd();
const name = process.argv[2] ?? '';
const withJs = process.argv.includes('--js');
if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name)) {
  console.error('Usage: npm run new-block -- <kebab-case-name> [--js]');
  process.exit(1);
}
const contentType = name.replace(/-([a-z0-9])/g, (_m: string, c: string) => c.toUpperCase());
const RUNTIME = '@contentworker/frontend';
const created: string[] = [];
const write = (rel: string, text: string) => {
  const path = join(site, rel);
  if (existsSync(path)) throw new Error(`${rel} already exists`);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
  created.push(rel);
};

write(
  `blocks/${name}.render.ts`,
  `import { type Entry, html, type RenderCtx, type Safe } from '${RUNTIME}';

/**
 * ${name}: the server half. Returns finished, semantic HTML; ${withJs ? `public/blocks/${name}/${name}.js adds behaviour only.` : 'it needs no client JS.'}
 * Fields (add a "${contentType}" variant to the page's sections in ContentWorker): heading, body.
 */
export const name = '${name}';
export const contentType = '${contentType}';
export const css = true;
export const js = ${withJs};

export default function render(entry: Entry, ctx: RenderCtx): Safe {
  const { heading, body } = entry.fields;
  ctx.headingLevel = Math.max(ctx.headingLevel, 2);
  return html\`\${heading ? html\`<h2>\${heading}</h2>\` : ''}\${body ? ctx.richText(body) : ''}\`;
}
`,
);
write(
  `public/blocks/${name}/${name}.css`,
  `/* ${name}: keep under 3 KB gzip; anything that changes layout belongs here, not in lazy CSS. */\n.${name} {\n  display: block;\n}\n`,
);
if (withJs) {
  write(
    `public/blocks/${name}/${name}.js`,
    `/**\n * Enhances the server-rendered ${name} block: listeners and ARIA state only, never moving or\n * removing server content. Keep under 4 KB gzip.\n * @param {HTMLElement} block\n */\nexport default function decorate(block) {\n  block.dataset.enhanced = 'true';\n}\n`,
  );
}

// src/worker.ts: create on first use, then add the import and the registration.
const workerRel = 'src/worker.ts';
const workerPath = join(site, workerRel);
const ident = contentType;
let worker = existsSync(workerPath)
  ? readFileSync(workerPath, 'utf8')
  : `import { defineSite } from '${RUNTIME}';\n\n// new-block:imports\n\nexport default defineSite({\n  blocks: [\n    // new-block:blocks\n  ],\n});\nexport { PurgeQueue, Site } from '${RUNTIME}';\n`;
if (!worker.includes('// new-block:imports') || !worker.includes('// new-block:blocks')) {
  throw new Error(
    `${workerRel} has no "// new-block:imports" and "// new-block:blocks" markers; add the block to defineSite({ blocks }) by hand.`,
  );
}
worker = worker
  .replace(
    '// new-block:imports',
    `// new-block:imports\nimport * as ${ident} from '../blocks/${name}.render.ts';`,
  )
  .replace('    // new-block:blocks', `    // new-block:blocks\n    ${ident},`);
if (!existsSync(workerPath)) created.push(workerRel);
mkdirSync(join(site, 'src'), { recursive: true });
writeFileSync(workerPath, worker);

// wrangler.jsonc: main → src/worker.ts, and an assets binding for public/.
const wranglerPath = join(site, 'wrangler.jsonc');
if (existsSync(wranglerPath)) {
  let w = readFileSync(wranglerPath, 'utf8');
  const before = w;
  w = w.replace(/"main"\s*:\s*"[^"]*frontend\/src\/entry\.ts"/, '"main": "src/worker.ts"');
  if (!/"assets"\s*:/.test(w))
    w = w.replace(
      /("main"\s*:\s*"[^"]*",?)/,
      '$1\n  "assets": { "directory": "public", "binding": "ASSETS" },',
    );
  if (w !== before) {
    writeFileSync(wranglerPath, w);
    console.log('updated wrangler.jsonc: main → src/worker.ts, assets → public/');
  }
}

console.log(`created ${created.join(', ')}; registered "${contentType}" in ${workerRel}.
Next: in ContentWorker, add a "${contentType}" variant (fields: heading, body) to the page's sections.`);
