# Changelog

`@contentworker/frontend` follows semantic versioning. Sites pin a version and upgrade on
purpose. A **major** version is anything that can change a site's output or its integration: HTML
structure or classes a site's CSS targets, CSS token names, block field names or variants,
`defineSite` options, required `wrangler.jsonc` settings, or the content model. New blocks, routes,
tokens or options are **minor**; fixes that keep output stable are **patch**.

## Releasing

Bump `version` in `package.json`, add its section here, merge, then push the tag
`frontend@v<version>`: `release.yml` checks and publishes it to npm with provenance.

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
