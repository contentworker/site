import type { Delivery } from '../delivery.ts';
import { escapeHtml } from '../html.ts';
import { listingFor, pathFor, routedTypes } from '../routes.ts';
import type { Entry } from '../types.ts';

/** Routed content types get a sitemap each; a type over PER_FILE URLs is split into parts. */
export const PER_FILE = 10_000;

const indexable = (e: Entry | null | undefined): boolean =>
  Boolean(!e?.fields?.seo?.noindex && pathFor(e));

/** Every indexable entry of a type: path and last publish, one page of Delivery at a time. */
async function* entriesOf(
  delivery: Delivery,
  contentType: string,
  { skip = 0, max = Number.POSITIVE_INFINITY } = {},
): AsyncGenerator<Entry> {
  let n = 0;
  for await (const e of delivery.iterate(contentType, {
    select: 'fields.slug,fields.seo',
    include: 0,
  })) {
    if (!indexable(e)) continue;
    if (n++ < skip) continue;
    if (n > skip + max) return;
    yield e;
  }
}

/** The sitemap index: one file per routed type (more when a type passes PER_FILE). */
export async function sitemapIndex({
  delivery,
  origin,
}: {
  delivery: Delivery;
  origin: string;
}): Promise<string> {
  const files: string[] = [];
  for (const type of routedTypes()) {
    let count = 0;
    for await (const _ of entriesOf(delivery, type)) count += 1; // eslint-disable-line no-unused-vars
    for (let part = 1; part <= Math.max(1, Math.ceil(count / PER_FILE)); part += 1) {
      if (count) files.push(`${origin}/sitemaps/${type}-${part}.xml`);
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${files.map((loc) => `<sitemap><loc>${escapeHtml(loc)}</loc></sitemap>`).join('\n')}
</sitemapindex>
`;
}

/** One sitemap file: up to PER_FILE URLs of one type. */
export async function sitemapFile({
  delivery,
  origin,
  type,
  part,
}: {
  delivery: Delivery;
  origin: string;
  type: string;
  part: number;
}): Promise<string | null> {
  if (!routedTypes().includes(type) || part < 1) return null;
  const urls: string[] = [];
  // The type's listing page (if it has one) goes in its first sitemap.
  const listing = part === 1 ? listingFor(type) : null;
  if (listing) urls.push(`<url><loc>${escapeHtml(`${origin}${listing.path}`)}</loc></url>`);
  for await (const e of entriesOf(delivery, type, { skip: (part - 1) * PER_FILE, max: PER_FILE })) {
    const lastmod = e.publishedAt ? `<lastmod>${escapeHtml(e.publishedAt)}</lastmod>` : '';
    urls.push(`<url><loc>${escapeHtml(origin + pathFor(e))}</loc>${lastmod}</url>`);
  }
  if (!urls.length && part > 1) return null;
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>
`;
}
