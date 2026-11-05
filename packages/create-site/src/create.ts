/**
 * `npm create @contentworker/site [dir]`: a new ContentWorker site on @contentworker/frontend.
 *
 * Writes the two files a site is (package.json, wrangler.jsonc), its theme hook, .gitignore,
 * README and a .dev.vars holding the Delivery key, then installs, and, given a Management key,
 * creates the content model and starter pages in the space. Every prompt has a flag, so CI and
 * agents run it unattended (`--yes`); off a terminal it never prompts.
 */

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { files } from './templates.ts';

export interface Io {
  cwd: string;
  env: Record<string, string | undefined>;
  interactive: boolean;
  ask(question: string, fallback?: string): Promise<string>;
  log(line: string): void;
  run(
    cmd: string,
    args: string[],
    opts: { cwd: string; env?: Record<string, string> },
  ): Promise<number>;
}

export interface Options {
  dir: string;
  delivery: string;
  key?: string;
  locale: string;
  origin?: string;
  cmaKey?: string;
  install: boolean;
}

export class UsageError extends Error {}

const USAGE = `Usage: npm create @contentworker/site [dir] -- [options]

  --delivery <url>   Delivery URL, https://cdn.<your domain>/<space>/<env>
  --key <key>        a Content Delivery API key for the space (written to .dev.vars)
  --locale <code>    default en-US
  --origin <url>     the site's public origin, e.g. https://www.example.com
  --cma-key <key>    a Management key: also create the content model and starter pages
  --no-install       skip npm install (and seeding)
  --yes              take defaults, never prompt
  --help`;

const FLAGS = new Set(['delivery', 'key', 'locale', 'origin', 'cma-key']);

export function parseArgs(argv: string[]): { dir?: string; flags: Map<string, string | true> } {
  const flags = new Map<string, string | true>();
  let dir: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    // `npm create x -- --flag` drops the separator; npx and other package managers pass it on.
    if (arg === '--') continue;
    if (!arg.startsWith('--')) {
      if (dir) throw new UsageError(`Unexpected argument: ${arg}`);
      dir = arg;
      continue;
    }
    const [name, inline] = arg.slice(2).split(/=(.*)/s, 2) as [string, string | undefined];
    if (name === 'yes' || name === 'no-install' || name === 'help') {
      flags.set(name, true);
      continue;
    }
    if (!FLAGS.has(name)) throw new UsageError(`Unknown option --${name}\n\n${USAGE}`);
    const value = inline ?? argv[++i];
    if (value === undefined || value.startsWith('--'))
      throw new UsageError(`--${name} needs a value`);
    flags.set(name, value);
  }
  return dir === undefined ? { flags } : { dir, flags };
}

/** The Delivery URL, checked: https (http only for localhost), and a <space>/<env> path. */
export function checkDelivery(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new UsageError(`--delivery must be a URL like https://cdn.example.com/<space>/<env>`);
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
    throw new UsageError('--delivery must use https');
  const parts = url.pathname
    .replace(/^\/(delivery\/)?/, '')
    .replace(/\/$/, '')
    .split('/');
  if (parts.length !== 2 || !parts.every((p) => /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(p)))
    throw new UsageError('--delivery path must be /<space>/<env>');
  return `${url.origin}/${parts.join('/')}`;
}

/** The Management API origin for a Delivery URL: cdn.<domain> → api.<domain>. */
export function apiOrigin(delivery: string): string {
  const url = new URL(delivery);
  return url.origin.replace('//cdn.', '//api.');
}

async function gather(argv: string[], io: Io): Promise<Options | null> {
  const { dir, flags } = parseArgs(argv);
  if (flags.has('help')) {
    io.log(USAGE);
    return null;
  }
  const quiet = flags.has('yes') || !io.interactive;
  const get = async (name: string, question: string, fallback?: string) => {
    const given = flags.get(name);
    if (typeof given === 'string') return given;
    if (quiet) return fallback ?? '';
    return io.ask(question, fallback);
  };
  const target = dir ?? (quiet ? 'my-site' : await io.ask('Directory', 'my-site'));
  const delivery = await get(
    'delivery',
    'Delivery URL (https://cdn.<your domain>/<space>/<env>)',
    io.env.CONTENTWORKER,
  );
  if (!delivery) throw new UsageError(`--delivery is required\n\n${USAGE}`);
  const key = await get(
    'key',
    'Content Delivery API key (Settings → API keys; blank to add later)',
    io.env.CONTENTWORKER_KEY,
  );
  const locale = await get('locale', 'Default locale', 'en-US');
  const origin = await get('origin', "The site's public origin (blank for none yet)");
  const cmaKey = await get(
    'cma-key',
    'Management key to create the content model and starter pages (blank to skip)',
    io.env.CONTENTWORKER_CMA_KEY,
  );
  const opts: Options = {
    dir: target,
    delivery: checkDelivery(delivery),
    locale: locale || 'en-US',
    install: !flags.has('no-install'),
  };
  if (key) opts.key = key;
  if (origin) opts.origin = new URL(origin).origin;
  if (cmaKey) opts.cmaKey = cmaKey;
  return opts;
}

/** Worker names: lowercase letters, digits and dashes, at most 63 characters. */
export function workerName(dir: string): string {
  const name = basename(resolve(dir))
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
  return name || 'my-site';
}

export async function create(argv: string[], io: Io): Promise<number> {
  const opts = await gather(argv, io);
  if (!opts) return 0;
  const root = resolve(io.cwd, opts.dir);
  if (existsSync(root) && readdirSync(root).length > 0)
    throw new UsageError(`${opts.dir} already exists and isn't empty`);
  // With a public origin and a Management key, seeding also registers the purge webhook; its
  // secret is generated here and kept in .dev.vars for `wrangler secret put`.
  const webhookSecret =
    opts.install && opts.cmaKey && opts.origin ? randomBytes(32).toString('hex') : undefined;
  const written = files({
    name: workerName(root),
    delivery: opts.delivery,
    locale: opts.locale,
    ...(opts.origin ? { origin: opts.origin } : {}),
    ...(opts.key ? { key: opts.key } : {}),
    ...(webhookSecret ? { webhookSecret } : {}),
  });
  for (const [path, { body, mode }] of Object.entries(written)) {
    const file = join(root, path);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, body, mode === undefined ? {} : { mode });
    io.log(`  wrote ${path}`);
  }
  if (!opts.install) {
    io.log(`\nCreated ${opts.dir}. Next: cd ${opts.dir} && npm install && npm run dev`);
    return 0;
  }
  if ((await io.run('npm', ['install', '--no-audit', '--no-fund'], { cwd: root })) !== 0) {
    io.log('\nnpm install failed; fix it, then run npm install again.');
    return 1;
  }
  if (opts.cmaKey) {
    io.log('\nCreating the content model and starter pages…');
    const webhook = webhookSecret
      ? ['--webhook', `${opts.origin}/__cw/webhook`, '--webhook-secret', webhookSecret]
      : [];
    const code = await io.run('npx', ['contentworker-site', 'seed', ...webhook], {
      cwd: root,
      env: {
        CONTENTWORKER: opts.delivery,
        CONTENTWORKER_API: apiOrigin(opts.delivery),
        CONTENTWORKER_CMA_KEY: opts.cmaKey,
        CONTENTWORKER_LOCALE: opts.locale,
      },
    });
    if (code !== 0) {
      io.log('Seeding failed; run `npm run seed -- --dry-run` in the site to see why.');
      return 1;
    }
  }
  io.log(`\nCreated ${opts.dir}.`);
  io.log(`  cd ${opts.dir}`);
  if (!opts.key) io.log('  add CONTENTWORKER_KEY=<a Content Delivery API key> to .dev.vars');
  io.log('  npm run dev            the site on http://localhost:8787');
  io.log('  npx wrangler secret put CONTENTWORKER_KEY   before the first deploy');
  if (webhookSecret)
    io.log(
      '  npx wrangler secret put CONTENTWORKER_WEBHOOK_SECRET   (the value in .dev.vars), for purge on publish',
    );
  return 0;
}
