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

- **Live preview in the ContentWorker admin.** Pages under `/__preview` showing a draft load
  `scripts/live-preview.js`, which connects through `connectPreview` from
  `@contentworker/sdk/live-preview` (0.3, vendored into `scripts/vendor/sdk/` with its own budget)
  when the admin frames the page: unsaved edits re-render through `POST /__preview/render`, only
  the blocks that changed when that is safe; Coworker's proposals show as ghosts
  (`styles/preview.css`); the page reports its entry (at most `PAGE_REPORT_LIMIT`) to each
  session and starts over on `disconnect`.
- Under `/__preview` only, drafts carry content refs with field paths (`data-cw-ref` on the page's
  fields, each block and the fields in it, `data-cw-slot` on the blocks' container); block
  renderers mark their own fields with `ctx.ref(field)`. Links to the site's pages stay under
  `/__preview`. Public pages are byte-identical (a golden test holds them).
- Preview links can carry the token in the fragment (`/__preview?entry={id}#token={token}`): a
  tiny page reads it, drops it from history and submits it in a same-origin form POST, so it
  never reaches a log or a `Referer`. `?token=` still works, and sets the cookie only for a
  navigation. `/__preview/exit?to=` goes only to a path on the site.
- Preview responses may be framed only by the admin (`frame-ancestors`, derived from
  `CONTENTWORKER` or the new optional `CONTENTWORKER_ADMIN`; never the site's own origin; a
  malformed value is logged and turns framing off), send no `Referer`, and the preview cookie is
  `SameSite=None; Secure; Partitioned` (grants also clear the older unpartitioned cookie).
- `ctx.cssVars({...})` is the one way to write CSS custom properties from content: every value
  passes `isSafeTokenValue` from `@contentworker/sdk`, on every render, and an unsafe one is
  dropped whole.
- `npm run seed` resolves a signed upload URL relative to the API (a local stack answers one).
- Depends on `@contentworker/sdk` ^0.3.0 (its content-ref helpers replace the runtime's copy).

## 0.4.0

**Breaking** for sites that override a runtime file, target its markup, or set CSS tokens. The
runtime's names are now its own:

| Was                                                                        | Now                                                                         |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `styles/eager.css`, `styles/lazy.css`                                      | `styles/critical.css`, `styles/deferred.css`                                |
| `scripts/lib.js`, `scripts/site.js`, `scripts/delayed.js`                  | `scripts/enhance.js`, `scripts/boot.js`, `scripts/idle.js`                  |
| `loadCSS`, `loadScript`                                                    | `addStylesheet`, `addScript`                                                |
| `loadBlock`, `loadSection`, `loadSections`                                 | `enhanceBlock`, `enhanceSection`, `enhanceSections`                         |
| `codeBasePath`, `toClassName`, `waitForFirstImage`                         | `codeRoot`, `classNameOf`, `firstImageReady`                                |
| `data-block-name`, `data-block-status`, `data-section-status`              | `data-block`, `data-block-state`, `data-section-state`                      |
| states `initialized`, `loading`, `loaded`                                  | `pending`, `running`, `done`                                                |
| `.default-content-wrapper`, `.button-wrapper`                              | `.prose`, `.cta-row`                                                        |
| `.<block>-container`, `.<block>-wrapper`                                   | `.with-<block>`, `.<block>-frame`                                           |
| `--background-color`, `--text-color`, `--link-color`, `--link-hover-color` | `--color-bg`, `--color-text`, `--color-link`, `--color-link-hover`          |
| `--light-color`, `--dark-color`, `--on-accent-color`, `--on-image-color`   | `--color-surface`, `--color-muted`, `--color-on-accent`, `--color-on-image` |
| `--body-font-family`, `--heading-font-family`, `--mono-font-family`        | `--font-body`, `--font-heading`, `--font-mono`                              |
| `--body-font-size-*`, `--heading-font-size-*`                              | `--text-*`, `--heading-*`                                                   |

- A site's `public/styles/site.css` keeps its name and its place. `npx contentworker-site new-block`
  now writes `export default function enhance(block)`; existing block scripts keep working, because
  the runtime calls the default export whatever its name.
- Depends on `@contentworker/sdk` `^0.2.0`.

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
