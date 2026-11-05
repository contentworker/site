/**
 * The files a new site starts with. A site is a package.json and a wrangler.jsonc; the rest is
 * its theme hook, its secrets for local development and a README. Kept in step with the showcase
 * site's own config (the repo root) by test/create.test.ts.
 */
/** The @contentworker/frontend range new sites depend on; a test holds it to the package. */
export const FRONTEND_RANGE = '^0.2.0';
/** wrangler for new sites: the version the runtime is tested with. */
export const WRANGLER_RANGE = '^4.156.1';
export const COMPATIBILITY_DATE = '2026-10-15';
export function files(site) {
  const vars = {
    CONTENTWORKER: site.delivery,
    CONTENTWORKER_LOCALE: site.locale,
    ...(site.origin ? { SITE_ORIGIN: site.origin } : {}),
    BUILD_ID: 'dev',
  };
  const devVars = [
    '# Local secrets for `npm run dev`. Never commit this file; deploy with `wrangler secret put`.',
    `CONTENTWORKER_KEY=${site.key ?? ''}`,
    ...(site.webhookSecret ? [`CONTENTWORKER_WEBHOOK_SECRET=${site.webhookSecret}`] : []),
    '',
  ].join('\n');
  return {
    'package.json': {
      body: `${JSON.stringify(
        {
          name: site.name,
          private: true,
          type: 'module',
          scripts: {
            dev: 'wrangler dev',
            deploy: 'wrangler deploy',
            seed: 'contentworker-site seed',
            'new-block': 'contentworker-site new-block',
          },
          dependencies: { '@contentworker/frontend': FRONTEND_RANGE },
          devDependencies: { wrangler: WRANGLER_RANGE },
        },
        null,
        2,
      )}\n`,
    },
    'wrangler.jsonc': {
      body: `{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": ${JSON.stringify(site.name)},
  // The whole Worker comes from @contentworker/frontend. For your own blocks, point main at
  // src/worker.ts and call defineSite (npx contentworker-site new-block <name> does it for you).
  "main": "node_modules/@contentworker/frontend/src/entry.ts",
  "compatibility_date": ${JSON.stringify(COMPATIBILITY_DATE)},
  // Workers Caching: pages are rendered by the cached Site entrypoint; the gateway is not cached.
  "cache": { "enabled": true },
  "exports": {
    "default": { "type": "worker", "cache": { "enabled": false } },
    "Site": { "type": "worker", "cache": { "enabled": true } }
  },
  // PurgeQueue batches purges on publish. Migration tags only ever append.
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["PurgeQueue"] }],
  "assets": {
    "directory": "public",
    "binding": "ASSETS",
    "not_found_handling": "none",
    "html_handling": "none"
  },
  "observability": { "enabled": true },
  "vars": ${JSON.stringify(vars, null, 2).replace(/\n/g, '\n  ')}
  // Secrets: CONTENTWORKER_KEY (a Content Delivery API key) and, for purge on publish,
  // CONTENTWORKER_WEBHOOK_SECRET. Locally they come from .dev.vars.
  // Your domain, once it's on Cloudflare (www redirects to SITE_ORIGIN by itself):
  // "routes": [{ "pattern": "example.com", "custom_domain": true }]
}
`,
    },
    'public/styles/site.css': {
      body: `/*
 * This site's theme: the runtime appends it to its critical CSS, after every runtime rule, so
 * overriding the tokens is enough. Keep it small; it counts toward the 8 KB critical CSS budget.
 *
 *   :root { --link-color: #0b6e4f; --content-width: 1080px; }
 *   @media (prefers-color-scheme: dark) { :root { --link-color: #6fe3b9; } }
 */
`,
    },
    '.dev.vars': { body: devVars, mode: 0o600 },
    '.gitignore': { body: 'node_modules/\n.wrangler/\n.dev.vars\n' },
    'README.md': {
      body: `# ${site.name}

A ContentWorker site on [@contentworker/frontend](https://www.npmjs.com/package/@contentworker/frontend).

\`\`\`sh
npm run dev                          # http://localhost:8787
npx wrangler secret put CONTENTWORKER_KEY
npm run deploy
\`\`\`

- **Theme:** \`public/styles/site.css\` overrides the CSS tokens.
- **Blocks:** \`npm run new-block -- <name> [--js]\`.
- **Content model and starter pages:** \`CONTENTWORKER_API=… CONTENTWORKER_CMA_KEY=… npm run seed -- --dry-run\`.
- **Purge on publish:** a ContentWorker webhook to \`https://<your site>/__cw/webhook\`, with its
  secret set as \`CONTENTWORKER_WEBHOOK_SECRET\`.

Guide: https://contentworker.site/integrate
`,
    },
  };
}
