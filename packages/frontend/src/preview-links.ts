import { escapeHtml } from './html.ts';
import { match, normalize } from './routes.ts';

/**
 * Keeps a live preview session inside preview. In the admin's frame, a link to a public page
 * would load a page that refuses to be framed, so on pages rendered for a session every link to
 * one of this site's pages becomes `/__preview/<path>?cw_session=<session>`: the draft where the
 * link leads to it, published content (with the preview bar) everywhere else.
 *
 * Runs on the HTML the runtime itself built (every attribute double-quoted and escaped by
 * `html`/`attrs`), and only rewrites `<a href>`. Links to other origins, fragment-only links,
 * mailto:, tel: and anything that isn't one of the site's routes (files, Markdown twins, feeds)
 * are left alone, as is anything already under /__preview. Public pages never come through here.
 */
const ANCHOR_HREF = /(<a\b[^>]*?\shref=")([^"]*)(")/g;
const PREFIX = '/__preview';
export const SESSION_PARAM = 'cw_session';

const UNESCAPE: Record<string, string> = {
  '&amp;': '&',
  '&quot;': '"',
  '&#39;': "'",
  '&lt;': '<',
  '&gt;': '>',
};

/** `href` (as written in the page) rewritten into the session, or null to leave it alone. */
export function previewHref(
  href: string,
  { origins, session }: { origins: readonly string[]; session: string },
): string | null {
  if (!href || href.startsWith('#')) return null;
  const base = origins[0];
  if (!base) return null;
  let url: URL;
  try {
    url = new URL(href, base);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !origins.includes(url.origin)) return null;
  if (url.pathname === PREFIX || url.pathname.startsWith(`${PREFIX}/`)) return null;
  const { path } = normalize(url);
  if (!match(path)) return null;
  const search = new URLSearchParams(url.search);
  search.set(SESSION_PARAM, session);
  return `${PREFIX}${path === '/' ? '/' : path}?${search}${url.hash}`;
}

export function stayInPreview(
  html: string,
  options: { origins: readonly string[]; session: string },
): string {
  return html.replace(ANCHOR_HREF, (whole, open: string, value: string, close: string) => {
    const href = value.replace(/&(amp|quot|#39|lt|gt);/g, (e) => UNESCAPE[e] ?? e);
    const next = previewHref(href, options);
    return next === null ? whole : `${open}${escapeHtml(next)}${close}`;
  });
}
