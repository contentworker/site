#!/usr/bin/env node
// PageSpeed Insights on every URL in a live site's sitemap, mobile and desktop. Fails below 100
// in any of the four categories. ORIGIN=https://contentworker.site PSI_API_KEY=… node scripts/psi.ts
import { mkdirSync, writeFileSync } from 'node:fs';

const origin = (process.env.ORIGIN ?? 'https://contentworker.site').replace(/\/$/, '');
const key = process.env.PSI_API_KEY;
if (!key) throw new Error('Set PSI_API_KEY');
const CATEGORIES = ['PERFORMANCE', 'ACCESSIBILITY', 'BEST_PRACTICES', 'SEO'];
const MAX_URLS = Number(process.env.PSI_MAX_URLS ?? 50);

async function locs(url: string): Promise<string[]> {
  const xml = await (await fetch(url)).text();
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1] ?? '').filter(Boolean);
}

const index = await locs(`${origin}/sitemap.xml`);
const urls = (await Promise.all(index.map(locs))).flat().slice(0, MAX_URLS);
const rows: string[] = [];
let failed = 0;
for (const url of urls) {
  for (const strategy of ['MOBILE', 'DESKTOP']) {
    const qs = new URLSearchParams({ url, strategy, key });
    for (const c of CATEGORIES) qs.append('category', c);
    const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${qs}`);
    const body = (await res.json()) as {
      lighthouseResult?: { categories: Record<string, { score: number }> };
    };
    const cats = body.lighthouseResult?.categories ?? {};
    const scores = ['performance', 'accessibility', 'best-practices', 'seo'].map((c) =>
      Math.round((cats[c]?.score ?? 0) * 100),
    );
    const ok = res.ok && scores.every((s) => s === 100);
    if (!ok) failed += 1;
    rows.push(`| ${url} | ${strategy.toLowerCase()} | ${scores.join(' | ')} |${ok ? '' : ' ❌'}`);
  }
}
const summary = `## PageSpeed Insights: ${failed ? `${failed} below 100` : 'all 100'}\n\n| URL | Strategy | Perf | A11y | Best practices | SEO |\n| --- | --- | --- | --- | --- | --- |\n${rows.join('\n')}\n`;
console.log(summary);
mkdirSync('.wrangler', { recursive: true });
writeFileSync('.wrangler/psi-summary.md', summary);
if (process.env.GITHUB_STEP_SUMMARY)
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, summary, { flag: 'a' });
process.exit(failed ? 1 : 0);
