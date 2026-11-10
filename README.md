# ContentWorker site starter

A fast website for [ContentWorker](https://docs.contentworker.app) content: plain HTML, CSS and
JavaScript, rendered by a Cloudflare Worker and streamed finished to the browser. Clone it to
start a site. https://contentworker.site runs this repo unchanged.

- **Edge** (`src/`): pages are served from Cloudflare's edge cache. On a miss, the Worker finds
  the entry for the URL, renders it to semantic HTML, streams it, and caches it tagged with
  everything it used. A publish purges exactly those pages.
- **Static assets** (`public/`): the CSS and JS the browser loads, served exactly as written.
- **Browser**: optional block behaviour in three phases (critical, deferred, idle). Every page
  reads fully with JavaScript off.

## Start a site

```sh
npm create @contentworker/site my-site
```

It asks for your Delivery URL and key, writes the site and installs it; with a Management key it
also creates the content model and starter pages ([`@contentworker/create-site`](packages/create-site/README.md)).

## Integrate: two files

A ContentWorker site is `@contentworker/frontend` plus configuration. The runtime owns the
Worker, the edge cache and purge, preview, SEO and GEO, every primary block, the base styles and
the browser scripts, so updating it is `npm update`.

`package.json`:

```json
{
  "private": true,
  "type": "module",
  "dependencies": { "@contentworker/frontend": "^0.1.0" },
  "devDependencies": { "wrangler": "^4.156.1" }
}
```

`wrangler.jsonc`:

```jsonc
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

Then `wrangler secret put CONTENTWORKER_KEY` (a Content Delivery API key), and you're live.
Same Cloudflare account as the CMS? Use `"CONTENTWORKER": "<space>/<env>"` with a
`CONTENTWORKER_DELIVERY` service binding instead.

### Only when you customise

- **Your theme** goes in `public/styles/site.css`: CSS token overrides, appended to the runtime's
  critical CSS when served (no extra request, and runtime updates keep reaching you). See the
  example at the top of the runtime's `public/styles/site.css`.
- **Your own files** go in `public/`, and win over the runtime's at the same path (for example
  `public/styles/critical.css` to restyle). Add `"assets": { "directory": "public", "binding": "ASSETS" }`.
- **Your own blocks** (or replacements, matched by content type): `npm run new-block -- <name> [--js]`
  creates `blocks/<name>.render.ts` and `public/blocks/<name>/`, registers it in `src/worker.ts`
  (created on first use) and points `wrangler.jsonc` there. By hand, it looks like this:

  ```ts
  import { defineSite } from '@contentworker/frontend';
  import * as testimonial from './blocks/testimonial.render.ts';
  export default defineSite({ blocks: [testimonial] });
  export { PurgeQueue, Site } from '@contentworker/frontend';
  ```

- **URLs come from the CMS.** Each content type's URL pattern in ContentWorker (`/{slug}`,
  `/blog/{slug}`, `/shop/{handle}`) becomes a route, so a new routed type needs no site change.
  The site reads them from Delivery's `/routes` and keeps them for a minute.
- **Your own URLs** override the CMS's, in the same call. Links, listings (paged at `/<path>/page/<n>`),
  sitemaps, llms.txt and Markdown twins all follow from the route table:

  ```ts
  export default defineSite({
    routes: [
      { path: '/products/:slug', contentType: 'product' },
      { path: '/products', list: 'product', title: 'Products' },
      { path: '/news/:slug', contentType: 'article' }, // replaces the default /blog/:slug
    ],
  });
  ```

### Content model and starter content

One command creates the content types the runtime renders, and the starter content (what
contentworker.site shows), in a ContentWorker space:

```sh
CONTENTWORKER_API=https://api.<your domain> \
CONTENTWORKER=<space>/<env> \
CONTENTWORKER_CMA_KEY=<content management key> \
npm run seed -w @contentworker/frontend -- --dry-run   # drop --dry-run to apply
```

- Content types are created and published when missing; existing ones are left alone.
- Starter content goes only into a space with no pages yet (`--force` to add it anyway).
- `--webhook https://<site>/__cw/webhook --webhook-secret <secret>` also registers the purge
  webhook; set the same secret as `CONTENTWORKER_WEBHOOK_SECRET` on the site.
- Pages are built from a **blocks field** (`sections`): editors add a hero, cards, columns, FAQ,
  call to action, media or a shared section from one "Add block" menu.
- Redirects are ContentWorker's own (managed in the CMS, plus one for every published slug
  change); the site applies them to any path without a page.

The model is `packages/frontend/content-model/model.ts`; the content is
`content-model/starter-content.ts`.

## Publish → live in about a minute

Pages are cached at Cloudflare's edge (Workers Caching) and purged when content changes:

1. In ContentWorker, add a webhook to `https://<your site>/__cw/webhook`. Pick topics
   `entry.*`, `entries.published_bulk`, `asset.*`, `content_type.published`,
   `release.published` and `environment_alias.changed` (or `*`), and set a secret.
2. `wrangler secret put CONTENTWORKER_WEBHOOK_SECRET` with the same secret.

## Built for search and answer engines

Every site gets `/sitemap.xml`, `/robots.txt`, `/llms.txt`, `/llms-full.txt`, JSON-LD and a
Markdown version of every page (`/about.md`, or `Accept: text/markdown`), all generated from
content and cached at the edge.

## Preview drafts

Set the entry preview link in ContentWorker to
`https://<your site>/__preview?entry={id}&token={token}`. Drafts render under `/__preview/…`,
never cached and never indexed. If your Preview API isn't at `api.<domain>`, set
`CONTENTWORKER_PREVIEW` to its origin.

## Develop

See `AGENTS.md` for the rules (budgets, phases, blocks).
