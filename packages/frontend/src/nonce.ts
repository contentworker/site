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
import { CSP, CSP_DIRECTIVES } from './headers.ts';

export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

/**
 * A response's CSP with a nonce: strict-dynamic for CSP3 browsers, 'self' for older ones. Every
 * page directive stays; one the response sets itself replaces the page's (a preview page's
 * frame-ancestors and Trusted Types), and `script-src` always becomes the nonce.
 *
 * A header may join several policies with `,` (each is enforced). The first is merged as above;
 * each later one keeps its own directives, with its `script-src`, if it has one, given the same
 * nonce, so no policy blocks the scripts this response stamped.
 */
export function nonceCsp(nonce: string, policy: string = CSP): string {
  const script = `script-src 'nonce-${nonce}' 'strict-dynamic' 'self'`;
  const [first = '', ...others] = policy.split(',');
  const own = directives(first);
  const names = new Set([...CSP_DIRECTIVES.map(nameOf), ...own.keys()]);
  names.delete('script-src');
  const page = new Map(CSP_DIRECTIVES.map((d) => [nameOf(d), d] as const));
  const merged = [script, ...[...names].map((n) => own.get(n) ?? page.get(n) ?? n)].join('; ');
  const rest = others
    .map((p) => [...directives(p)].map(([n, d]) => (n === 'script-src' ? script : d)).join('; '))
    .filter(Boolean);
  return [merged, ...rest].join(', ');
}

const nameOf = (directive: string): string => directive.split(/\s+/)[0] ?? directive;

function directives(policy: string): Map<string, string> {
  return new Map(
    policy
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => [nameOf(d), d] as const),
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
  headers.set(
    'content-security-policy',
    nonceCsp(nonce, headers.get('content-security-policy') ?? CSP),
  );
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
