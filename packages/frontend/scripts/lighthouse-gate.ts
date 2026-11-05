#!/usr/bin/env node
// The Lighthouse gate: every page scores 100 in performance, accessibility, best practices and
// SEO, on mobile and desktop, or the run fails. It measures the real site Worker (wrangler dev)
// against the mock Delivery API (scripts/mock-delivery.ts), with Lighthouse 13 (what PageSpeed
// Insights runs). Each page gets the median of RUNS runs, after one warm-up run per form factor.
//
//   npm run lighthouse                  (from the repo root)
//   LH_URLS=/,/about npm run lighthouse
import { type ChildProcess, spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch } from 'chrome-launcher';
import lighthouse, { desktopConfig } from 'lighthouse';

const SITE_PORT = Number(process.env.LH_SITE_PORT ?? 8790);
const MOCK_PORT = Number(process.env.LH_MOCK_PORT ?? 8788);
const RUNS = Number(process.env.LH_RUNS ?? 3);
// The starter content: the pages contentworker.site serves (LH_CONTENT=fixtures for the fixtures).
const CONTENT = process.env.LH_CONTENT ?? 'starter';
const URLS = (
  process.env.LH_URLS ??
  (CONTENT === 'starter'
    ? '/,/blocks,/integrate,/blog,/blog/why-pages-render-at-the-edge'
    : '/,/about,/blocks,/blog,/blog/edge-rendering')
).split(',');
const GATED = ['performance', 'accessibility', 'best-practices', 'seo'] as const;
const root = new URL('../../..', import.meta.url).pathname;
const base = `http://127.0.0.1:${SITE_PORT}`;

const children: ChildProcess[] = [];
const start = (cmd: string, args: string[]) => {
  const child = spawn(cmd, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  children.push(child);
  return child;
};
const stop = () => {
  for (const c of children) {
    try {
      if (c.pid) process.kill(-c.pid);
    } catch {
      // already gone
    }
  }
};
process.on('exit', stop);
process.on('SIGINT', () => process.exit(130));

async function waitFor(url: string, seconds = 60): Promise<void> {
  for (let i = 0; i < seconds * 2; i += 1) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timed out waiting for ${url}`);
}

start('node', ['packages/frontend/scripts/mock-delivery.ts', String(MOCK_PORT), CONTENT]);
start('npx', [
  'wrangler',
  'dev',
  '--port',
  String(SITE_PORT),
  '--ip',
  '127.0.0.1',
  '--inspector-port',
  '0',
  '--var',
  `CONTENTWORKER:http://localhost:${MOCK_PORT}/site/main`,
  '--var',
  'CONTENTWORKER_KEY:lighthouse',
  '--var',
  `SITE_ORIGIN:${base}`,
  '--var',
  'BUILD_ID:lighthouse',
]);
await waitFor(`http://localhost:${MOCK_PORT}/delivery/site/main/entries?content_type=siteSettings`);
await waitFor(`${base}/health`);

const chrome = await launch({ chromeFlags: ['--headless=new', '--no-sandbox'] });
type Scores = Record<string, number>;
interface Row {
  url: string;
  formFactor: string;
  scores: Scores;
  lcp: number;
  cls: number;
  tbt: number;
  failing: string[];
}
const rows: Row[] = [];

try {
  for (const formFactor of ['mobile', 'desktop'] as const) {
    const config = formFactor === 'desktop' ? desktopConfig : undefined;
    const run = (path: string) =>
      lighthouse(
        `${base}${path}`,
        { port: chrome.port, output: 'json', logLevel: 'error' },
        config,
      );
    await run('/'); // warm-up: a cold profile's first run is noise
    for (const path of URLS) {
      const results = [];
      for (let i = 0; i < RUNS; i += 1) {
        const res = await run(path);
        if (res) results.push(res.lhr);
      }
      results.sort(
        (a, b) => (a.categories.performance?.score ?? 0) - (b.categories.performance?.score ?? 0),
      );
      const lhr = results[Math.floor(results.length / 2)];
      if (!lhr) throw new Error(`no result for ${path}`);
      const scores: Scores = {};
      for (const [id, c] of Object.entries(lhr.categories))
        scores[id] = Math.round((c.score ?? 0) * 100);
      const failing = GATED.flatMap((cat) =>
        (lhr.categories[cat]?.auditRefs ?? [])
          .filter((r) => r.weight > 0 && (lhr.audits[r.id]?.score ?? 1) < 1)
          .map(
            (r) =>
              `${cat}/${r.id}${lhr.audits[r.id]?.displayValue ? ` (${lhr.audits[r.id]?.displayValue})` : ''}`,
          ),
      );
      rows.push({
        url: path,
        formFactor,
        scores,
        lcp: Math.round(lhr.audits['largest-contentful-paint']?.numericValue ?? 0),
        cls: Number((lhr.audits['cumulative-layout-shift']?.numericValue ?? 0).toFixed(3)),
        tbt: Math.round(lhr.audits['total-blocking-time']?.numericValue ?? 0),
        failing,
      });
    }
  }
} finally {
  await chrome.kill();
}

const pass = (r: Row) => GATED.every((c) => r.scores[c] === 100);
const lines = [
  '| Page | Form factor | Perf | A11y | Best practices | SEO | LCP | CLS | TBT |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ...rows.map(
    (r) =>
      `| \`${r.url}\` | ${r.formFactor} | ${r.scores.performance} | ${r.scores.accessibility} | ${r.scores['best-practices']} | ${r.scores.seo} | ${r.lcp} ms | ${r.cls} | ${r.tbt} ms |${pass(r) ? '' : ' ❌'}`,
  ),
];
const failures = rows.filter((r) => !pass(r));
const summary = `## Lighthouse ${failures.length ? 'failed' : 'passed'}: ${rows.length - failures.length}/${rows.length} at 100\n\n${lines.join('\n')}\n${
  failures.length
    ? `\n### Failing audits\n\n${failures.map((r) => `- \`${r.url}\` ${r.formFactor}: ${r.failing.join(', ') || 'score below 100'}`).join('\n')}\n`
    : ''
}`;
console.log(summary);
writeFileSync(join(root, '.wrangler/lighthouse-summary.md'), summary);
if (process.env.GITHUB_STEP_SUMMARY)
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, summary, { flag: 'a' });
process.exit(failures.length ? 1 : 0);
