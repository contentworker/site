import type { Backend } from './config.ts';
import { textHeaders } from './headers.ts';
import { normalize, pathFor } from './routes.ts';
import type { Entry } from './types.ts';

/**
 * Draft preview, never cached. ContentWorker mints a preview link per entry (a `pw_…` token,
 * valid for that one entry). Point the link at:
 *
 *   https://<site>/__preview?entry=<entryId>&token=<pw_…>
 *
 * That checks the token against the Preview API, keeps it in an HttpOnly cookie scoped to
 * /__preview, and redirects to /__preview/<the entry's path>. Pages under /__preview render the
 * draft for its own path and published content everywhere else, with `private, no-store` and
 * noindex. The /__preview prefix is also what keeps drafts out of the edge cache: it is a
 * different cache key, and it is answered by the uncached gateway.
 */
export const PREFIX = '/__preview';
const COOKIE = 'cw_preview';
const MAX_AGE = 60 * 60;

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

function readCookie(request: Request): { entryId: string; token: string } | null {
  const raw = request.headers.get('cookie') ?? '';
  const match = raw.split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
  if (!match) return null;
  const [entryId, token] = decodeURIComponent(match.slice(COOKIE.length + 1)).split('~');
  return entryId && token ? { entryId, token } : null;
}

const cookie = (value: string, maxAge: number): string =>
  `${COOKIE}=${value}; Path=${PREFIX}; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

/**
 * @param {{ request: Request, url: URL, cw: any, render: (opts: { path: string, preview: any }) => Promise<Response> }} deps
 */
export interface PreviewDeps {
  request: Request;
  url: URL;
  cw: Backend;
  render: (opts: {
    path: string;
    preview: { entry: Entry | null; path: string };
  }) => Promise<Response>;
}

export async function handlePreview({ request, url, cw, render }: PreviewDeps): Promise<Response> {
  if (!cw.preview)
    return new Response('Preview is not configured (set CONTENTWORKER_PREVIEW).', {
      status: 404,
      headers: textHeaders(),
    });

  if (url.pathname === PREFIX) {
    const entryId = url.searchParams.get('entry');
    const token = url.searchParams.get('token');
    if (!entryId || !token || !/^[\w.-]+$/.test(token))
      return new Response('Missing entry or token.', { status: 400, headers: textHeaders() });
    const draft = await fetchDraft(cw, entryId, token);
    if (!draft)
      return new Response('This preview link is invalid or has expired.', {
        status: 403,
        headers: textHeaders(),
      });
    const path = pathFor(draft) ?? '/';
    return new Response(null, {
      status: 303,
      headers: textHeaders({
        location: `${PREFIX}${path === '/' ? '/' : path}`,
        'set-cookie': cookie(`${encodeURIComponent(entryId)}~${token}`, MAX_AGE),
      }),
    });
  }

  if (url.pathname === `${PREFIX}/exit`) {
    const to = url.searchParams.get('to') ?? '/';
    const safe = to.startsWith('/') && !to.startsWith('//') ? to : '/';
    return new Response(null, {
      status: 303,
      headers: textHeaders({ location: safe, 'set-cookie': cookie('', 0) }),
    });
  }

  const sitePath = url.pathname.slice(PREFIX.length) || '/';
  const { path } = normalize(new URL(sitePath, url.origin));
  const grant = readCookie(request);
  let entry: Entry | null = null;
  if (grant) {
    const draft = await fetchDraft(cw, grant.entryId, grant.token);
    if (draft && pathFor(draft) === path) entry = draft;
  }
  return render({ path, preview: { entry, path } });
}
