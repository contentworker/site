/**
 * One canonical host. A request to the www twin of SITE_ORIGIN's host (or to the bare host when
 * the canonical one is www.) is redirected there, path and query kept, so a site can attach both
 * hostnames as custom domains and needs no DNS record or redirect rule of its own. Only that twin
 * moves: workers.dev, preview and local hosts are left alone, so previews and `wrangler dev` keep
 * working. GET and HEAD get a 301; anything else a 308, which keeps the method and body.
 */
export function hostRedirect(
  request: Request,
  url: URL,
  siteOrigin: string | undefined,
): Response | null {
  if (!siteOrigin) return null;
  let canonical: URL;
  try {
    canonical = new URL(siteOrigin);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const want = canonical.hostname.toLowerCase();
  if (host === want || (host !== `www.${want}` && want !== `www.${host}`)) return null;
  const status = request.method === 'GET' || request.method === 'HEAD' ? 301 : 308;
  return new Response(null, {
    status,
    headers: {
      location: new URL(`${url.pathname}${url.search}`, canonical.origin).href,
      'cache-control': 'public, max-age=86400',
    },
  });
}
