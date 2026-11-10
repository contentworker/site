import type { Backend } from './config.ts';
import { previewHeaders, textHeaders } from './headers.ts';
import { renderPreviewBlocks } from './preview-render.ts';
import { normalize, pathFor } from './routes.ts';
import type { Entry, PreviewState } from './types.ts';

/**
 * Draft preview, never cached. ContentWorker mints a preview link per entry (a `pw_…` token,
 * valid for that one entry). Point the link at either form:
 *
 *   https://<site>/__preview?entry=<entryId>#token=<pw_…>   (recommended)
 *   https://<site>/__preview?entry=<entryId>&token=<pw_…>   (still accepted)
 *
 * A token in the fragment never reaches a server log or a Referer. The fragment never reaches
 * this Worker either, so that form answers a tiny page whose script reads it, drops it from
 * history and POSTs it back here (same origin only). Both forms check the token against the
 * Preview API, keep it in an HttpOnly cookie scoped to /__preview, and send the browser to
 * /__preview/<the entry's path>. Pages under /__preview render the draft for its own path and
 * published content everywhere else, with `private, no-store` and noindex. The /__preview
 * prefix is also what keeps drafts out of the edge cache: it is a different cache key, and it is
 * answered by the uncached gateway.
 *
 * The admin frames these pages for live preview, so the cookie is `SameSite=None; Partitioned`
 * (sent inside the admin's iframe, and kept in the admin's partition only) and every response
 * names the admin as the only origin that may frame it. A page showing the draft also loads the
 * live preview script, which connects only inside the admin's frame and re-renders blocks
 * through POST /__preview/render. Links to the site's pages stay under /__preview.
 */
export const PREFIX = '/__preview';
export const RENDER_PATH = `${PREFIX}/render`;
const COOKIE = 'cw_preview';
const MAX_AGE = 60 * 60;
/** Entry ids are UUIDs (and test ids): no `~`, which separates the cookie's two parts. */
const ENTRY_ID = /^[A-Za-z0-9_-]{1,128}$/;
const TOKEN = /^[\w.-]{1,512}$/;
const MAX_HANDOFF_BYTES = 4 * 1024;

/** Reads one draft entry with its preview token (no API key needed: the token is the grant). */
export async function fetchDraft(
  cw: Backend,
  entryId: string,
  token: string,
): Promise<Entry | null> {
  if (!cw.preview) return null;
  const qs = new URLSearchParams({ preview_token: token, locale: cw.locale, include: '3' });
  const res = await fetch(`${cw.preview}/entries/${encodeURIComponent(entryId)}?${qs}`, {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) return null;
  return (await res.json()) as Entry;
}

/**
 * Every preview grant the browser sent. There can be two for a while: the partitioned cookie and
 * an older unpartitioned (SameSite=Lax) one from before 0.4, which grants also clear.
 */
export function readCookies(request: Request): { entryId: string; token: string }[] {
  const raw = request.headers.get('cookie') ?? '';
  const out: { entryId: string; token: string }[] = [];
  for (const c of raw.split(/;\s*/)) {
    if (!c.startsWith(`${COOKIE}=`)) continue;
    let value: string;
    try {
      value = decodeURIComponent(c.slice(COOKIE.length + 1));
    } catch {
      continue;
    }
    const [entryId, token] = value.split('~');
    if (entryId && token && out.length < 4) out.push({ entryId, token });
  }
  return out;
}

/** The grant for `entryId` when one was sent, else the first grant. */
export function readCookie(
  request: Request,
  entryId?: string,
): { entryId: string; token: string } | null {
  const all = readCookies(request);
  return all.find((g) => g.entryId === entryId) ?? all[0] ?? null;
}

/**
 * The grant cookie. `SameSite=None` so it is sent inside the admin's cross-site iframe;
 * `Partitioned` (CHIPS) so a framed copy lives only in the admin's partition and no other site
 * that frames this one can use it; HttpOnly, Secure and the /__preview path as before. Clearing
 * repeats the same attributes, or the browser would treat it as a different cookie.
 */
const cookie = (value: string, maxAge: number): string =>
  `${COOKIE}=${value}; Path=${PREFIX}; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=${maxAge}`;

/** Clears the unpartitioned SameSite=Lax cookie releases before 0.4 set. Drop it in a later major. */
const LEGACY_CLEAR = `${COOKIE}=; Path=${PREFIX}; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

/** Set-Cookie headers for a grant (or, with '', for clearing it), legacy cookie cleared first. */
function setCookies(headers: Headers, value: string, maxAge: number): Headers {
  headers.append('set-cookie', LEGACY_CLEAR);
  headers.append('set-cookie', cookie(value, maxAge));
  return headers;
}

export interface PreviewDeps {
  request: Request;
  url: URL;
  cw: Backend;
  /** The site's origin and versioned code base, for the re-render endpoint. */
  site: { origin: string; codeBase: string };
  render: (opts: {
    path: string;
    preview: PreviewState;
    /** The origin allowed to frame the page (frameAncestor), or null for nobody. */
    admin: string | null;
  }) => Promise<Response>;
}

/**
 * The origin preview responses let frame them: the admin, unless that would be the site itself
 * (a derived guess that landed on the site's own host), when nobody may.
 */
export function frameAncestor(cw: Backend, url: URL, siteOrigin: string): string | null {
  return cw.admin && cw.admin !== url.origin && cw.admin !== siteOrigin ? cw.admin : null;
}

/** A plain-text answer with the preview headers (framing, Referer, noindex). */
function text(
  admin: string | null,
  body: string,
  status: number,
  extra: Record<string, string> = {},
) {
  return new Response(body, {
    status,
    headers: textHeaders({ ...previewHeaders(admin), ...extra }),
  });
}

/** Where a valid grant lands: the draft's path under /__preview. */
function landing(draft: Entry): string {
  const path = pathFor(draft) ?? '/';
  const to = `${PREFIX}${path === '/' ? '/' : path}`;
  return to;
}

/**
 * A POST from this site's own pages: `Origin` must be exactly this origin (and Sec-Fetch-Site, when
 * sent, `same-origin`). Pages under /__preview send no Referer, which also blanks `Origin` on a
 * POST, so their scripts ask for `referrerPolicy: 'same-origin'` on these requests.
 */
export function fromOwnPages(request: Request, url: URL): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') return false;
  return request.headers.get('origin') === url.origin;
}

/** The body as text, or null when it is larger than `max` bytes (read no further than that). */
export async function readCapped(request: Request, max: number): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > max) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** The JSON body of a same-origin POST, or the Response refusing it. */
export async function jsonBody(
  request: Request,
  url: URL,
  admin: string | null,
  max: number,
): Promise<{ body: Record<string, unknown> } | { refused: Response }> {
  if (!fromOwnPages(request, url))
    return { refused: text(admin, 'Cross-origin request refused.', 403) };
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json'))
    return { refused: text(admin, 'Send application/json.', 415) };
  const raw = await readCapped(request, max);
  if (raw === null) return { refused: text(admin, 'Request body too large.', 413) };
  try {
    const body: unknown = JSON.parse(raw);
    if (body && typeof body === 'object' && !Array.isArray(body))
      return { body: body as Record<string, unknown> };
  } catch {
    // fall through
  }
  return { refused: text(admin, 'Send a JSON object.', 400) };
}

/** Checks a token and answers with the grant cookie and a redirect to the draft. */
async function grant(
  cw: Backend,
  admin: string | null,
  entryId: unknown,
  token: unknown,
): Promise<Response> {
  if (
    typeof entryId !== 'string' ||
    typeof token !== 'string' ||
    !ENTRY_ID.test(entryId) ||
    !TOKEN.test(token)
  )
    return text(admin, 'Missing entry or token.', 400);
  const draft = await fetchDraft(cw, entryId, token);
  if (!draft) return text(admin, 'This preview link is invalid or has expired.', 403);
  const location = landing(draft);
  const value = `${encodeURIComponent(entryId)}~${token}`;
  return new Response(null, {
    status: 303,
    headers: setCookies(
      new Headers(textHeaders({ ...previewHeaders(admin), location })),
      value,
      MAX_AGE,
    ),
  });
}

/** The fields of a same-origin form POST, or the Response refusing it. */
async function formBody(
  request: Request,
  url: URL,
  admin: string | null,
  max: number,
): Promise<{ body: URLSearchParams } | { refused: Response }> {
  if (!fromOwnPages(request, url))
    return { refused: text(admin, 'Cross-origin request refused.', 403) };
  const type = (request.headers.get('content-type') ?? '').toLowerCase();
  if (!type.startsWith('application/x-www-form-urlencoded'))
    return { refused: text(admin, 'Send the preview form.', 415) };
  const raw = await readCapped(request, max);
  if (raw === null) return { refused: text(admin, 'Request body too large.', 413) };
  return { body: new URLSearchParams(raw) };
}

/**
 * The fragment handoff, run by the page below while it is still being parsed. It reads `#token=`
 * and drops the fragment from history before anything else, so the token is gone from the
 * address bar, history and any later Referer, then submits it in a form POST to /__preview,
 * which sets the cookie and redirects to the draft. Submitting during parsing aborts this page
 * before its `load`, so a framing admin sees one page load (the draft's), not two. Reads the
 * entry from its own URL: nothing from the request is printed into the page.
 */
export const HANDOFF_SCRIPT = `(()=>{const q=new URLSearchParams(location.search),t=new URLSearchParams(location.hash.slice(1)).get('token'),f=document.forms[0];history.replaceState(null,'',location.pathname+location.search);if(!t||!f){const s=document.getElementById('cw-status');if(s)s.textContent='This preview link has no token.';return}f.elements.namedItem('entry').value=q.get('entry')||'';f.elements.namedItem('token').value=t;f.submit()})()`;

/**
 * The handoff page. Its own Referrer-Policy is `same-origin` (every other preview response sends
 * none): a POST from a page that sends no Referer carries `Origin: null`, and /__preview checks
 * Origin. Same-origin only, so nothing leaves the site; the token was never in the URL's query.
 */
const HANDOFF_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Opening preview</title></head><body><p id="cw-status" role="status">Opening the preview…</p><form method="post" action="${PREFIX}" hidden><input type="hidden" name="entry"><input type="hidden" name="token"></form><noscript><p>Preview links that carry the token after # need JavaScript. Use the ?token= form instead.</p></noscript><script>${HANDOFF_SCRIPT}</script></body></html>`;

function handoffPage(admin: string | null): Response {
  // The gateway's withNonce stamps this response's nonce on the script and into its CSP.
  return new Response(HANDOFF_PAGE, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      ...previewHeaders(admin),
      'referrer-policy': 'same-origin',
    },
  });
}

/**
 * Whether a GET may set the grant cookie: only a navigation (top level or in a frame). A preview
 * link loaded as an image, script or fetch could otherwise plant someone else's grant.
 */
function isNavigation(request: Request): boolean {
  const dest = request.headers.get('sec-fetch-dest');
  return !dest || dest === 'document' || dest === 'iframe';
}

/** `to` as a path on this site (path, query and fragment), or `/` for anything else. */
export function samePath(to: string, url: URL): string {
  let target: URL;
  try {
    target = new URL(to, url.origin);
  } catch {
    return '/';
  }
  if (target.origin !== url.origin || target.pathname.startsWith('//')) return '/';
  return `${target.pathname}${target.search}${target.hash}`;
}

export async function handlePreview(deps: PreviewDeps): Promise<Response> {
  const { request, url, cw, render, site } = deps;
  const admin = frameAncestor(cw, url, site.origin);
  if (!cw.preview)
    return new Response('Preview is not configured (set CONTENTWORKER_PREVIEW).', {
      status: 404,
      headers: textHeaders(previewHeaders(admin)),
    });

  if (request.method === 'POST') {
    if (url.pathname === PREFIX) {
      if (!isNavigation(request)) return text(admin, 'Open preview links as a page.', 403);
      const read = await formBody(request, url, admin, MAX_HANDOFF_BYTES);
      if ('refused' in read) return read.refused;
      return grant(cw, admin, read.body.get('entry'), read.body.get('token'));
    }
    if (url.pathname === RENDER_PATH) return renderPreviewBlocks({ request, url, cw, site, admin });
    return text(admin, 'Method not allowed', 405, { allow: 'GET, HEAD' });
  }

  if (url.pathname === PREFIX) {
    const entryId = url.searchParams.get('entry');
    const token = url.searchParams.get('token');
    if (token !== null) {
      if (!isNavigation(request)) return text(admin, 'Open preview links as a page.', 403);
      return grant(cw, admin, entryId, token);
    }
    if (!entryId || !ENTRY_ID.test(entryId)) return text(admin, 'Missing entry or token.', 400);
    return handoffPage(admin);
  }

  if (url.pathname === `${PREFIX}/exit`) {
    const location = samePath(url.searchParams.get('to') ?? '/', url);
    return new Response(null, {
      status: 303,
      headers: setCookies(new Headers(textHeaders({ ...previewHeaders(admin), location })), '', 0),
    });
  }

  const sitePath = url.pathname.slice(PREFIX.length) || '/';
  const { path } = normalize(new URL(sitePath, url.origin));
  let entry: Entry | null = null;
  // At most a couple of grants (a legacy cookie beside the current one): the draft for this path.
  for (const granted of readCookies(request).slice(0, 2)) {
    const draft = await fetchDraft(cw, granted.entryId, granted.token);
    if (draft && pathFor(draft) === path) {
      entry = draft;
      break;
    }
  }
  return render({
    path,
    admin,
    preview: {
      entry,
      path,
      scope: { space: cw.space, environment: cw.environment, locale: cw.locale },
      live: entry && admin ? { admin } : null,
      framed: request.headers.get('sec-fetch-dest') === 'iframe',
    },
  });
}
