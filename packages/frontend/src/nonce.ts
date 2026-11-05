/**
 * A fresh CSP nonce for every visitor, on HTML that is cached and shared at the edge.
 *
 * The cached `Site` entrypoint's pages carry `script-src 'self'` and no nonce (a nonce baked into
 * a shared page would be shared). As a page streams out through the uncached gateway,
 * HTMLRewriter puts a new nonce on every <script> and the CSP becomes `'nonce-…' 'strict-dynamic'`,
 * so only this response's own scripts (and what they import) run. Nothing is buffered, so first
 * byte is unchanged. Outside workerd (node tests) there is no HTMLRewriter and responses pass
 * through with the `'self'` policy.
 */
import { CSP_DIRECTIVES } from './headers.ts';

export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

/** The page CSP with a nonce: strict-dynamic for CSP3 browsers, 'self' for older ones. */
export function nonceCsp(nonce: string): string {
  return [`script-src 'nonce-${nonce}' 'strict-dynamic' 'self'`, ...CSP_DIRECTIVES.slice(1)].join(
    '; ',
  );
}

const weak = (etag: string | null) => (etag && !etag.startsWith('W/') ? `W/${etag}` : etag);

export function withNonce(res: Response): Response {
  const Rewriter = (globalThis as { HTMLRewriter?: typeof HTMLRewriter }).HTMLRewriter;
  if (!Rewriter) return res;
  // A 304 for a page we rewrite answers with the same (weak) validator the 200 carried.
  if (res.status === 304) {
    const etag = weak(res.headers.get('etag'));
    if (!etag || etag === res.headers.get('etag')) return res;
    const headers = new Headers(res.headers);
    headers.set('etag', etag);
    return new Response(null, { status: 304, headers });
  }
  if (!(res.headers.get('content-type') ?? '').startsWith('text/html')) return res;
  if (!res.body) {
    // HEAD: no scripts to stamp, but the same validator a GET would carry.
    const etag = weak(res.headers.get('etag'));
    if (!etag || etag === res.headers.get('etag')) return res;
    const headers = new Headers(res.headers);
    headers.set('etag', etag);
    return new Response(null, { status: res.status, headers });
  }
  const nonce = newNonce();
  const headers = new Headers(res.headers);
  headers.set('content-security-policy', nonceCsp(nonce));
  // The bytes now differ per visitor; the content doesn't: a weak validator says exactly that.
  const etag = weak(headers.get('etag'));
  if (etag) headers.set('etag', etag);
  return new Rewriter()
    .on('script', {
      element(el) {
        el.setAttribute('nonce', nonce);
      },
    })
    .transform(new Response(res.body, { status: res.status, statusText: res.statusText, headers }));
}
