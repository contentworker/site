# AGENTS.md

Rules for every change to this repo, for people and coding agents. The size budget is
`docs/budget.md`.

## What this is

The ContentWorker frontend starter, and the live showcase at https://contentworker.site (same
repo, no separate marketing build). A Cloudflare Worker renders each page from the ContentWorker
Delivery API into finished, semantic HTML and streams it; the browser only enhances.
Performance is the top priority: every other requirement yields to it.

## Layout

- `packages/frontend/`: `@contentworker/frontend`, the product. Everything an
  integration would otherwise write lives here, so sites stay a `package.json` and a
  `wrangler.jsonc`. Paths below are relative to it.
- `packages/create-site/`: `@contentworker/create-site`, `npm create @contentworker/site`. It
  writes a new site from `src/templates.ts`; a test holds the templates to the runtime's version
  and the showcase's config. Released by the tag `create-site@v<version>`.
- The repo root is the showcase site (https://contentworker.site): it has no code of its own, which
  proves the two-file integration works. Its `public/` holds only its favicon.
- `src/assets.generated.ts` embeds the runtime's `public/` (exact bytes) so sites serve it from
  the bundle; generated on install, gitignored.

## Where code runs

- **TypeScript where nothing is served, JavaScript where it is.** `src/`, the
  `*.render.ts` block halves, `scripts/` and `test/` are TypeScript 7 (`strict`,
  `noUncheckedIndexedAccess`, `erasableSyntaxOnly`): wrangler bundles the Worker, and Node runs
  the rest by stripping types, so there is no build step. `public/**/*.js` stays plain JavaScript
  with JSDoc types, checked by `tsconfig.browser.json`. Imports use explicit `.ts` extensions.
  `worker-configuration.d.ts` is generated (`npm run types`), never edited.
- `src/`: the Worker only. `worker.js` holds the gateway, the cached `Site` entrypoint and the
  `PurgeQueue` Durable Object; the rest covers rendering, caching, webhooks and preview. Plain ESM
  JavaScript.
- `public/`: served verbatim as static assets. **The served files are the source files**: no
  framework, no bundler, no transpiling for anything a browser loads.
- `public/blocks/<name>/<name>.render.ts` is the server half of a block. The Worker imports it,
  and `public/.assetsignore` keeps it from being served.

## Rules

- **Every visitor gets their own CSP nonce.** Cached HTML carries `script-src 'self'` and no nonce;
  the gateway's `withNonce` (`src/nonce.ts`, HTMLRewriter) stamps a fresh one on every `<script>` and
  sends `'nonce-…' 'strict-dynamic'`, with a weak ETag. Never put a nonce in cached HTML, and never
  add an inline script without going through the gateway.
- **Edge first.** Pages are served by Workers Caching from the `Site` entrypoint; the default
  export is an uncached gateway that must stay cheap (no I/O on the hot path). Anything a page
  renders from must be in its `Cache-Tag` (`tagsFor`), or a publish won't purge it. Nothing
  personalised or per-request goes in cached HTML: no nonces, cookies or user data. Drafts live
  only under `/__preview`.

- **The HTML is finished at first byte.** Sections, wrappers, buttons, image attributes and the
  LCP choice are decided in the Worker. Block JS may add behaviour, elements and attributes; it
  may never move, hide or remove server content (CLS 0, and the page reads with JS off).
- **Three phases** (`public/scripts/boot.js`). Critical: the first section's block JS. Deferred: the
  remaining blocks, `deferred.css`, fonts. Idle (3 s after load): analytics, consent, third
  parties. Nothing third-party loads before `load`.
- **Sites theme through tokens, not by forking files.** A site's `public/styles/site.css` is
  appended to `critical.css` by `src/assets.ts`. Give new styling a CSS token so sites can change it
  there; renaming or removing a token is a major version (`CHANGELOG.md`).
- **The package is the product.** `npm pack` must keep working: the CLI (`scripts/cli.ts` and what
  it imports) is compiled to `dist/` by `npm run build` because Node won't strip types in
  `node_modules`; Worker code ships as TypeScript. Never import Worker modules into the CLI's graph.
- **Anything that changes layout is in `critical.css` or the block's CSS, never `deferred.css`.** Late
  CSS that resizes something in the first viewport is a layout shift (the gate caught one).
- **Only `styles/critical.css` (and the first section's block CSS) may block rendering.** A later
  block's CSS is linked in the body just before its section.
- **Lighthouse 100 is a gate, not a goal.** CI's `lighthouse` job runs Lighthouse 13 (what
  PageSpeed Insights runs) on the real Worker under `wrangler dev` against
  `scripts/mock-delivery.ts`, and fails the PR below 100 in any category on mobile or desktop.
  When a new block or page type ships, add a page using it to the fixtures and to `LH_URLS`.
  Production is checked nightly by PageSpeed Insights (`psi.yml`).
- **Budgets are law** (`budgets.json`, `npm run budgets`): critical CSS 8 KB, critical JS 10 KB, and
  per block 3 KB CSS / 4 KB JS (gzip). Raising a number needs a measured reason in
  `docs/budget.md`.
- **Content is data.** Never emit a CMS string as markup: build HTML with `html`/`attrs` from
  `src/html.js`, which escape everything. Link URLs go through `safeHref`.
- **Images:** use `ctx.image(asset, { sizes })`. It takes signed URLs from the delivered asset and
  always sets width, height, alt, srcset and lazy loading. Never hand-build a media URL.
- **No secrets in the browser.** The Delivery key is a Worker secret.
- Fonts load lazily, each with a metric-matched fallback. No font preload unless measured.
- **URLs come from one route table** (`src/routes.ts`): the site's `defineSite({ routes })`, then the
  CMS's URL patterns (Delivery `/routes`, `src/cms-routes.ts`), then the defaults. Never
  hard-code a path or a content type's URL elsewhere: use `match`, `pathFor`, `routedTypes` and
  `listingFor`.
- Endpoints never end in "z" (`/health`, not `/healthz`).
- Deploys happen in CI only (`.github/workflows/deploy.yml`: on demand, or on every push to main
  once `DEPLOY_ENABLED` is `true`), after the full checks, followed by a smoke test of the live site.
  A dry run checks a bundle.

## Commands

```sh
npm install
npm run dev        # wrangler dev; needs .dev.vars (see .dev.vars.example)
npm test           # node:test on the .ts sources (type stripping): renderer, routes, the Worker end to end
npm run check-types # tsc on the Worker (TS) and the browser JS (JSDoc)
npm run lint       # Biome: lint + format check (npm run format to fix)
npm run types      # regenerate worker-configuration.d.ts after editing wrangler.jsonc
npm run budgets    # gzip sizes vs budgets.json
npm run lighthouse # the CI gate: 100 ×4 categories, mobile + desktop, real Worker vs mock Delivery
npm run check      # all of the above + bundle check
```

## Content model

`content-model/model.ts` is the source of truth for content types; `test/content-model.test.ts`
fails if a block has no variant, a variant has no block, or a URL pattern drifts from the routes.
The Lighthouse gate measures the starter content (`content-model/starter-content.ts`), so a new
block gets an example there.

## Adding a block

Two scaffolds. **A block for one site:** `npm run new-block -- <name> [--js]` from the site root
(`scripts/site-new-block.ts`). **A block every site gets (the runtime):** `npm run
new-runtime-block -w @contentworker/frontend -- <name> [--js]` creates `public/blocks/<name>/`
and a test, and registers it in `src/render/blocks.ts`; add its variant to `content-model/model.ts`
and an example to the starter content. Then add the content type in ContentWorker. A block's render module
exports:

- `name`, `contentType`, `css`, `js`, and a default `render(entry, ctx)` returning `html`…``.
  `ctx` gives `richText`, `image`, `href`, `pathFor`, `renderBlock` and the heading level.
- optionally `markdown(entry, ctx)`, for the page's Markdown twin and llms-full.txt.
- optionally `structuredData(entry)`, for JSON-LD nodes in `<head>` (see `faq`).

Prefer native HTML over JS: `<details>` for disclosures, `<video preload="none">` for video,
CSS `:has()` for state. All eight starter blocks ship without client JS.
