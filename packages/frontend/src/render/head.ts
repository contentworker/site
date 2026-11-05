import { attrs, html, jsonForScript, type Safe } from '../html.ts';
import { type Entry, type RichTextDocument, type RichTextNode, sectionsIn } from '../types.ts';
import { shareImageUrl } from './image.ts';
import { firstParagraph } from './richtext.ts';

/**
 * The page's SEO surface, all from content: title, description, canonical, robots, Open Graph,
 * Twitter and JSON-LD. Fallbacks: seo.title → title; seo.description → the first paragraph.
 */
export interface Seo {
  title: string;
  description: string;
  canonical: string | null;
  markdown: string | null;
  noindex: boolean;
  image: string | null;
  siteName: string;
  type: 'article' | 'website';
}

export function seoFor({
  entry,
  settings,
  url,
  notFound,
}: {
  entry: Entry | null;
  settings: Entry | null;
  url: string;
  notFound: boolean;
}): Seo {
  const f = entry?.fields ?? {};
  const seo = f.seo ?? {};
  const siteName = settings?.fields?.name ?? '';
  const pageTitle = seo.title || f.title || f.heading || (notFound ? 'Page not found' : siteName);
  const title = siteName && pageTitle !== siteName ? `${pageTitle} · ${siteName}` : pageTitle;
  // A page always has a description: its SEO field, its first paragraph anywhere (body, a block,
  // a fragment's blocks), the site's description, or its title.
  const description =
    seo.description ||
    firstParagraphIn(entry) ||
    settings?.fields?.description ||
    (notFound ? '' : siteName ? `${pageTitle} – ${siteName}` : pageTitle);
  const image = shareImageUrl(seo.image ?? f.image ?? sectionsIn(f.sections)[0]?.fields?.image);
  const path = new URL(url).pathname;
  return {
    title,
    description,
    canonical: notFound ? null : url,
    markdown: notFound || seo.noindex ? null : path === '/' ? '/index.md' : `${path}.md`,
    noindex: Boolean(notFound || seo.noindex),
    image,
    siteName,
    type: entry?.contentType === 'article' ? 'article' : 'website',
  };
}

export function jsonLd({
  entry,
  settings,
  seo,
  origin,
  extra = [],
}: {
  entry: Entry | null;
  settings: Entry | null;
  seo: Seo;
  origin: string;
  extra?: Record<string, unknown>[];
}): Record<string, unknown> | null {
  const graph: Record<string, unknown>[] = [];
  const siteName = settings?.fields?.name;
  if (siteName) {
    graph.push({
      '@type': 'WebSite',
      '@id': `${origin}/#website`,
      name: siteName,
      url: `${origin}/`,
    });
  }
  if (entry && seo.canonical) {
    const isArticle = entry.contentType === 'article';
    const author = entry.fields?.author?.fields?.name;
    graph.push({
      '@type': isArticle ? 'Article' : 'WebPage',
      '@id': `${seo.canonical}#page`,
      url: seo.canonical,
      [isArticle ? 'headline' : 'name']: seo.title.split(' · ')[0],
      description: seo.description || undefined,
      image: seo.image || undefined,
      isPartOf: siteName ? { '@id': `${origin}/#website` } : undefined,
      datePublished: isArticle ? (entry.fields?.publishedAt ?? entry.publishedAt) : undefined,
      dateModified: entry.publishedAt ?? undefined,
      author: author ? { '@type': 'Person', name: author } : undefined,
    });
  }
  const path = seo.canonical ? new URL(seo.canonical).pathname : '/';
  if (entry && seo.canonical && path !== '/') {
    const crumbs = [{ name: siteName || 'Home', item: `${origin}/` }];
    crumbs.push({ name: seo.title.split(' · ')[0], item: seo.canonical });
    graph.push({
      '@type': 'BreadcrumbList',
      itemListElement: crumbs.map((c, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: c.name,
        item: c.item,
      })),
    });
  }
  graph.push(...extra);
  return graph.length ? { '@context': 'https://schema.org', '@graph': graph } : null;
}

/**
 * Everything inside <head>. Only eager.css (and the first section's block CSS) is render-blocking;
 * site.js is a module (never blocks), lib.js is modulepreloaded so the import doesn't chain.
 */
export function renderHead({
  seo,
  ld,
  codeBase,
  firstCss,
  lang,
}: {
  seo: Seo;
  ld: Record<string, unknown> | null;
  codeBase: string;
  firstCss: string[];
  lang: string;
}): Safe {
  return html`<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${seo.title}</title>
${seo.description ? html`<meta name="description"${attrs({ content: seo.description })}>` : ''}
${seo.canonical ? html`<link rel="canonical"${attrs({ href: seo.canonical })}>` : ''}
${seo.markdown ? html`<link rel="alternate" type="text/markdown"${attrs({ href: seo.markdown })}>` : ''}
${seo.noindex ? html`<meta name="robots" content="noindex">` : ''}
<meta property="og:type"${attrs({ content: seo.type })}>
<meta property="og:title"${attrs({ content: seo.title })}>
${seo.description ? html`<meta property="og:description"${attrs({ content: seo.description })}>` : ''}
${seo.canonical ? html`<meta property="og:url"${attrs({ content: seo.canonical })}>` : ''}
${seo.siteName ? html`<meta property="og:site_name"${attrs({ content: seo.siteName })}>` : ''}
${seo.image ? html`<meta property="og:image"${attrs({ content: seo.image })}>` : ''}
${seo.image ? html`<meta name="twitter:card" content="summary_large_image">` : ''}
${lang ? html`<meta property="og:locale"${attrs({ content: lang.replace('-', '_') })}>` : ''}
<link rel="stylesheet"${attrs({ href: `${codeBase}/styles/eager.css` })}>
${firstCss.map((href: string) => html`<link rel="stylesheet"${attrs({ href })}>`)}
<link rel="modulepreload"${attrs({ href: `${codeBase}/scripts/lib.js` })}>
<script type="module"${attrs({ src: `${codeBase}/scripts/site.js` })}></script>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
${ld ? html`<script type="application/ld+json">${jsonForScript(ld)}</script>` : ''}`;
}

/** The first paragraph of any rich text in an entry's fields, depth-first through its blocks. */
function firstParagraphIn(entry: Entry | null, depth = 0): string {
  if (!entry?.fields || depth > 3) return '';
  for (const value of Object.values(entry.fields) as unknown[]) {
    const list = Array.isArray(value) ? value : [value];
    for (const v of list) {
      if (v && typeof v === 'object' && (v as RichTextNode).nodeType === 'document') {
        const text = firstParagraph(v as RichTextDocument);
        if (text) return text;
      } else if (v && typeof v === 'object' && 'fields' in v) {
        const text = firstParagraphIn(v as Entry, depth + 1);
        if (text) return text;
      } else if (v && typeof v === 'object' && !('nodeType' in v)) {
        const text = firstParagraphIn(
          { id: '', contentType: '', fields: v as Record<string, unknown> },
          depth + 1,
        );
        if (text) return text;
      }
    }
  }
  return '';
}
