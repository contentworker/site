# Changelog

`@contentworker/frontend` follows semantic versioning. Sites pin a version and upgrade on
purpose. A **major** version is anything that can change a site's output or its integration: HTML
structure or classes a site's CSS targets, CSS token names, block field names or variants,
`defineSite` options, required `wrangler.jsonc` settings, or the content model. New blocks, routes,
tokens or options are **minor**; fixes that keep output stable are **patch**.

## Releasing

Bump `version` in `package.json`, add its section here, merge, then push the tag
`frontend@v<version>`: `release.yml` checks and publishes it to npm with provenance.

## Unreleased

- Preview links can carry the token in the fragment (`/__preview?entry={id}#token={token}`), so it
  never reaches a log or a `Referer`; `?token=` still works, and sets the cookie only for a
  navigation. `/__preview/exit?to=` goes only to a path on the site.
- Preview pages are ready to be framed by the ContentWorker admin for live preview:
  `frame-ancestors` names the admin origin only (derived from `CONTENTWORKER`, or the new optional
  `CONTENTWORKER_ADMIN`; never the site's own origin; a malformed value is logged and turns
  framing off), `Referrer-Policy: no-referrer`, and the preview cookie is
  `SameSite=None; Secure; Partitioned` (grants also clear the older unpartitioned cookie).
- Under `/__preview` only, drafts carry content refs with field paths (`data-cw-ref` on fields and
  blocks, `data-cw-slot` on the blocks' container); block renderers mark their own fields with
  `ctx.ref(field)`. `POST /__preview/render` re-renders blocks, named by their refs, from unsaved
  fields. Links to the site's pages stay under `/__preview`.
- `scripts/live-preview.js` (calls `connectPreview` from `@contentworker/sdk/live-preview` once it
  is published; a stub until then) loads on `/__preview` pages showing a draft, and shows
  Coworker's proposals as ghosts (`styles/preview.css`). Public pages are unchanged.

## 0.3.0

- Navigation menus: the header renders ContentWorker's `main` menu and the footer its `footer`
  menu, nested up to three levels, with dropdowns on desktop that work on hover and keyboard focus
  without JS. With no menu, the header keeps using `siteSettings.nav`. Custom headers and footers
  read them from `ctx.menus`.
- Pages showing a menu carry the Cache-Tag `menu`. `menus.changed`, `entry.published` and
  `entry.unpublished` purge it, because a publish can add, rename or remove a menu item. Add the
  `menus.changed` topic to your purge webhook.

## 0.2.0

- The www twin of `SITE_ORIGIN`'s host (or the bare host, when the canonical one is `www.`)
  redirects to the canonical host, path and query kept: 301 for GET and HEAD, 308 otherwise.
  Attach both hostnames as Workers custom domains; no DNS record or redirect rule is needed.
  Other hosts (workers.dev, previews, local) are untouched.

## 0.1.0

- First release: the gateway and edge-cached `Site` entrypoint, purge on publish, preview,
  ContentWorker redirects, routes from the CMS's URL patterns, SEO and GEO routes, the primary
  blocks, base styles and browser scripts, `defineSite({ blocks, routes, header, footer })`, the
  `styles/site.css` theming hook, and the `contentworker-site` CLI (`new-block`, `seed`).
