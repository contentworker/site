# @contentworker/frontend

Everything a ContentWorker website needs, so a site is a `package.json` and a `wrangler.jsonc`:
pages rendered by a Cloudflare Worker from the Delivery API and served from the edge cache,
purged when content is published; preview; redirects and routes from the CMS; sitemaps,
robots.txt, llms.txt and a Markdown version of every page; the primary blocks, base styles and
browser scripts. Every page scores 100 in Lighthouse's four categories on mobile and desktop, and
CI keeps it there.

```jsonc
// wrangler.jsonc
{
  "name": "my-site",
  "main": "node_modules/@contentworker/frontend/src/entry.ts",
  "compatibility_date": "2026-10-15",
  "cache": { "enabled": true },
  "exports": {
    "default": { "type": "worker", "cache": { "enabled": false } },
    "Site": { "type": "worker", "cache": { "enabled": true } }
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["PurgeQueue"] }],
  "vars": { "CONTENTWORKER": "https://cdn.<your domain>/<space>/<env>", "BUILD_ID": "dev" }
}
```

Then `wrangler secret put CONTENTWORKER_KEY` (a Content Delivery API key).

## Make it yours, without forking it

- **Theme:** `public/styles/site.css` overrides the CSS tokens. It's appended to the runtime's
  critical CSS when served, so it costs no extra request.
- **Blocks:** `npx contentworker-site new-block <name> [--js]`.
- **URLs:** set each content type's URL pattern in ContentWorker, or pass
  `defineSite({ routes })`.
- **Any runtime file:** a file at the same path in your `public/` wins.
- **Content model and starter content:** `npx contentworker-site seed --dry-run`.

The full guide is at https://contentworker.site/integrate.
