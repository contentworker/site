# Changelog

`@contentworker/frontend` follows semantic versioning. Sites pin a version and upgrade on
purpose. A **major** version is anything that can change a site's output or its integration: HTML
structure or classes a site's CSS targets, CSS token names, block field names or variants,
`defineSite` options, required `wrangler.jsonc` settings, or the content model. New blocks, routes,
tokens or options are **minor**; fixes that keep output stable are **patch**.

## Releasing

Bump `version` in `package.json`, add its section here, merge, then push the tag
`frontend@v<version>`: `release.yml` checks and publishes it to npm with provenance.

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
