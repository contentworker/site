#!/usr/bin/env node
// Fails when any group or block in public/ is over its gzip budget in budgets.json.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = new URL('..', import.meta.url).pathname;
const pub = join(root, 'public');
interface Budgets {
  /** A group lists its files, or names a directory whose .js files it sums (vendored builds). */
  groups: { name: string; files?: string[]; dir?: string; max: number }[];
  perBlock: Record<'css' | 'js', number>;
  blockExceptions?: Record<string, Partial<Record<'css' | 'js', number>>>;
}
const budgets: Budgets = JSON.parse(readFileSync(join(root, 'budgets.json'), 'utf8'));
const gz = (file: string): number => gzipSync(readFileSync(file), { level: 9 }).length;

const rows: { name: string; size: number; max: number; error?: string }[] = [];
for (const group of budgets.groups) {
  const files =
    group.files ??
    (group.dir && existsSync(join(pub, group.dir))
      ? readdirSync(join(pub, group.dir))
          .filter((f) => f.endsWith('.js'))
          .map((f) => join(group.dir as string, f))
      : []);
  if (!files.length) {
    rows.push({ name: group.name, size: 0, max: group.max, error: `no files in ${group.dir}` });
    continue;
  }
  const missing = files.filter((f: string) => !existsSync(join(pub, f)));
  if (missing.length)
    rows.push({
      name: group.name,
      size: 0,
      max: group.max,
      error: `missing ${missing.join(', ')}`,
    });
  const size = files
    .filter((f: string) => existsSync(join(pub, f)))
    .reduce((n, f) => n + gz(join(pub, f)), 0);
  rows.push({ name: group.name, size, max: group.max });
}
for (const block of readdirSync(join(pub, 'blocks'))) {
  for (const kind of ['css', 'js'] as const) {
    const file = join(pub, 'blocks', block, `${block}.${kind}`);
    if (!existsSync(file)) continue;
    const max = budgets.blockExceptions?.[block]?.[kind] ?? budgets.perBlock[kind];
    rows.push({ name: `block ${block}.${kind}`, size: gz(file), max });
  }
}

let failed = false;
for (const r of rows) {
  const over = r.error || r.size > r.max;
  failed ||= Boolean(over);
  const status = r.error ? `FAIL (${r.error})` : over ? 'FAIL' : 'ok';
  console.log(
    `${status.padEnd(6)} ${r.name.padEnd(32)} ${String(r.size).padStart(6)} / ${r.max} B gzip`,
  );
}
if (failed) {
  console.error(
    '\nOver budget. Shrink it, or raise the budget with a measured reason in docs/budget.md.',
  );
  process.exit(1);
}
