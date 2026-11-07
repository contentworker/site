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
 * names the admin as the only origin that may frame it. With `cw_session` on the URL the page
 * also loads the live preview script, which re-renders blocks through POST /__preview/render.
 */
export const PREFIX = '/__preview';
export const RENDER_PATH = `${PREFIX}/render`;
const COOKIE = 'cw_preview';
const MAX_AGE = 60 * 60;
/** Entry ids are UUIDs (and test ids): no `~`, which separates the cookie's two parts. */
const ENTRY_ID = /^[A-Za-z0-9_-]{1,128}$/;
const TOKEN = /^[\w.-]{1,512}$/;
/** A live preview session id, as `@contentworker/sdk/live-preview` checks it. */
const SESSION = /^[A-Za-z0-9_-]{8,128}$/;
export const SESSION_PARAM = 'cw_session';
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

export function readCookie(request: Request): { entryId: string; token: string } | null {
  const raw = request.headers.get('cookie') ?? '';
  const match = raw.split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
  if (!match) return null;
  let value: string;
  try {
    value = decodeURIComponent(match.slice(COOKIE.length + 1));
  } catch {
    return null;
  }
  const [entryId, token] = value.split('~');
  return entryId && token ? { entryId, token } : null;
}

/**
 * The grant cookie. `SameSite=None` so it is sent inside the admin's cross-site iframe;
 * `Partitioned` (CHIPS) so a framed copy lives only in the admin's partition and no other site
 * that frames this one can use it; HttpOnly, Secure and the /__preview path as before. Clearing
 * repeats the same attributes, or the browser would treat it as a different cookie.
 */
const cookie = (value: string, maxAge: number): string =>
  `${COOKIE}=${value}; Path=${PREFIX}; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=${maxAge}`;

export interface PreviewDeps {
  request: Request;
  url: URL;
  cw: Backend;
  /** The site's origin and versioned code base, for the re-render endpoint. */
  site: { origin: string; codeBase: string };
  render: (opts: { path: string; preview: PreviewState }) => Promise<Response>;
}

/** A plain-text answer with the preview headers (framing, Referer, noindex). */
function text(cw: Backend, body: string, status: number, extra: Record<string, string> = {}) {
  return new Response(body, {
    status,
    headers: textHeaders({ ...previewHeaders(cw.admin), ...extra }),
  });
}

/** Where a valid grant lands: the draft's path, carrying the live preview session through. */
function landing(draft: Entry, session: string | null): string {
  const path = pathFor(draft) ?? '/';
  const to = `${PREFIX}${path === '/' ? '/' : path}`;
  return session ? `${to}?${new URLSearchParams({ [SESSION_PARAM]: session })}` : to;
}

const sessionOf = (value: unknown): string | null =>
  typeof value === 'string' && SESSION.test(value) ? value : null;

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
  cw: Backend,
  max: number,
): Promise<{ body: Record<string, unknown> } | { refused: Response }> {
  if (!fromOwnPages(request, url))
    return { refused: text(cw, 'Cross-origin request refused.', 403) };
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json'))
    return { refused: text(cw, 'Send application/json.', 415) };
  const raw = await readCapped(request, max);
  if (raw === null) return { refused: text(cw, 'Request body too large.', 413) };
  try {
    const body: unknown = JSON.parse(raw);
    if (body && typeof body === 'object' && !Array.isArray(body))
      return { body: body as Record<string, unknown> };
  } catch {
    // fall through
  }
  return { refused: text(cw, 'Send a JSON object.', 400) };
}

/** Checks a token and answers with the grant cookie, either as a redirect or as JSON. */
async function grant(
  cw: Backend,
  entryId: unknown,
  token: unknown,
  session: string | null,
  as: 'redirect' | 'json',
): Promise<Response> {
  if (
    typeof entryId !== 'string' ||
    typeof token !== 'string' ||
    !ENTRY_ID.test(entryId) ||
    !TOKEN.test(token)
  )
    return text(cw, 'Missing entry or token.', 400);
  const draft = await fetchDraft(cw, entryId, token);
  if (!draft) return text(cw, 'This preview link is invalid or has expired.', 403);
  const location = landing(draft, session);
  const setCookie = cookie(`${encodeURIComponent(entryId)}~${token}`, MAX_AGE);
  if (as === 'redirect')
    return new Response(null, {
      status: 303,
      headers: textHeaders({ ...previewHeaders(cw.admin), location, 'set-cookie': setCookie }),
    });
  return new Response(JSON.stringify({ location }), {
    headers: {
      ...textHeaders(previewHeaders(cw.admin)),
      'content-type': 'application/json; charset=utf-8',
      'set-cookie': setCookie,
    },
  });
}

/**
 * The fragment handoff, run by the page below. It reads `#token=` and drops the fragment from
 * history before anything else, so the token is gone from the address bar, history and any
 * later Referer, then trades it for the cookie and replaces itself with the draft. Reads the
 * entry and session from its own URL: nothing from the request is printed into the page.
 */
export const HANDOFF_SCRIPT = `(()=>{const q=new URLSearchParams(location.search),h=new URLSearchParams(location.hash.slice(1)),t=h.get('token'),s=document.getElementById('cw-status'),say=(m)=>{if(s)s.textContent=m};history.replaceState(null,'',location.pathname+location.search);if(!t){say('This preview link has no token.');return}fetch('${PREFIX}',{method:'POST',headers:{'content-type':'application/json'},credentials:'same-origin',referrerPolicy:'same-origin',body:JSON.stringify({entry:q.get('entry'),token:t,session:q.get('${SESSION_PARAM}')})}).then((r)=>r.ok?r.json():Promise.reject(r.status)).then((d)=>{if(typeof d.location!=='string'||!d.location.startsWith('${PREFIX}/'))throw 0;location.replace(d.location)}).catch((e)=>say(e===403?'This preview link is invalid or has expired.':'The preview could not start. Try the link again.'))})()`;

const HANDOFF_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><meta name="referrer" content="no-referrer"><title>Opening preview</title></head><body><p id="cw-status" role="status">Opening the preview…</p><noscript><p>Preview links that carry the token after # need JavaScript. Use the ?token= form instead.</p></noscript><script>${HANDOFF_SCRIPT}</script></body></html>`;

function handoffPage(cw: Backend): Response {
  // The gateway's withNonce stamps this response's nonce on the script and into its CSP.
  return new Response(HANDOFF_PAGE, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      ...previewHeaders(cw.admin),
    },
  });
}

export async function handlePreview(deps: PreviewDeps): Promise<Response> {
  const { request, url, cw, render, site } = deps;
  if (!cw.preview)
    return new Response('Preview is not configured (set CONTENTWORKER_PREVIEW).', {
      status: 404,
      headers: textHeaders(previewHeaders(cw.admin)),
    });

  if (request.method === 'POST') {
    if (url.pathname === PREFIX) {
      const read = await jsonBody(request, url, cw, MAX_HANDOFF_BYTES);
      if ('refused' in read) return read.refused;
      const { entry, token, session } = read.body;
      return grant(cw, entry, token, sessionOf(session), 'json');
    }
    if (url.pathname === RENDER_PATH) return renderPreviewBlocks({ request, url, cw, site });
    return text(cw, 'Method not allowed', 405, { allow: 'GET, HEAD' });
  }

  if (url.pathname === PREFIX) {
    const entryId = url.searchParams.get('entry');
    const token = url.searchParams.get('token');
    const session = sessionOf(url.searchParams.get(SESSION_PARAM));
    if (token !== null) return grant(cw, entryId, token, session, 'redirect');
    if (!entryId || !ENTRY_ID.test(entryId)) return text(cw, 'Missing entry or token.', 400);
    return handoffPage(cw);
  }

  if (url.pathname === `${PREFIX}/exit`) {
    const to = url.searchParams.get('to') ?? '/';
    const safe = to.startsWith('/') && !to.startsWith('//') ? to : '/';
    return new Response(null, {
      status: 303,
      headers: textHeaders({
        ...previewHeaders(cw.admin),
        location: safe,
        'set-cookie': cookie('', 0),
      }),
    });
  }

  const sitePath = url.pathname.slice(PREFIX.length) || '/';
  const { path } = normalize(new URL(sitePath, url.origin));
  const granted = readCookie(request);
  let entry: Entry | null = null;
  if (granted) {
    const draft = await fetchDraft(cw, granted.entryId, granted.token);
    if (draft && pathFor(draft) === path) entry = draft;
  }
  const session = sessionOf(url.searchParams.get(SESSION_PARAM));
  return render({
    path,
    preview: {
      entry,
      path,
      scope: { space: cw.space, environment: cw.environment, locale: cw.locale },
      live: entry && session && cw.admin ? { admin: cw.admin } : null,
    },
  });
}
