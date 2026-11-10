# Changelog

`@contentworker/create-site` follows semantic versioning. Release it like the runtime: bump
`version`, add its section here, merge, then push the tag `create-site@v<version>`.

## 0.1.3

- New sites use `@contentworker/frontend` 0.5.0: live preview in the ContentWorker admin.

## 0.1.2

- New sites use `@contentworker/frontend` 0.4.0, and the `site.css` template names its new
  tokens.

## 0.1.1

- New sites use `@contentworker/frontend` 0.3.0: navigation menus.

## 0.1.0

- `npm create @contentworker/site [dir]`: writes a site on `@contentworker/frontend`
  (`package.json`, `wrangler.jsonc`, the `site.css` theme hook, `.dev.vars`, `.gitignore`,
  README), installs it, and with `--cma-key` creates the content model and starter pages, plus
  the purge webhook when `--origin` is given. Every prompt has a flag; off a terminal it never
  prompts.
