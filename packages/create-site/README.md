# @contentworker/create-site

A new ContentWorker website on [@contentworker/frontend](https://www.npmjs.com/package/@contentworker/frontend),
ready to run:

```sh
npm create @contentworker/site my-site
cd my-site && npm run dev
```

It asks for your Delivery URL (`https://cdn.<your domain>/<space>/<env>`) and a Content Delivery
API key, writes the site (`package.json`, `wrangler.jsonc`, a `public/styles/site.css` theme hook,
`.dev.vars` with the key, `.gitignore`, README), and installs it. Give it a Management key and it
also creates the content model and starter pages in the space; give it the site's public origin
too and it registers the purge webhook.

Unattended (CI, agents), every prompt is a flag and it never prompts off a terminal:

```sh
npm create @contentworker/site my-site -- --yes \
  --delivery https://cdn.example.com/my-space/main --key "$CDA_KEY" \
  --cma-key "$CMA_KEY" --origin https://www.example.com
```

| Option         | Meaning                                                    |
| -------------- | ---------------------------------------------------------- |
| `--delivery`   | Delivery URL, `https://cdn.<your domain>/<space>/<env>`    |
| `--key`        | Content Delivery API key, written to `.dev.vars`           |
| `--locale`     | Default locale, `en-US` unless set                         |
| `--origin`     | The site's public origin (`SITE_ORIGIN`)                   |
| `--cma-key`    | Management key: create the content model and starter pages |
| `--no-install` | Write the files only                                       |
| `--yes`        | Take defaults, never prompt                                |

`CONTENTWORKER`, `CONTENTWORKER_KEY` and `CONTENTWORKER_CMA_KEY` in the environment fill the
matching prompts. Guide: https://contentworker.site/integrate
