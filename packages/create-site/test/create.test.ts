import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  apiOrigin,
  checkDelivery,
  create,
  type Io,
  UsageError,
  workerName,
} from '../src/create.ts';
import { COMPATIBILITY_DATE, FRONTEND_RANGE, WRANGLER_RANGE } from '../src/templates.ts';

const repo = new URL('../../..', import.meta.url).pathname;
const DELIVERY = 'https://cdn.example.com/my-space/main';

function fakeIo(answers: Record<string, string> = {}, interactive = false) {
  const runs: { cmd: string; args: string[]; env?: Record<string, string> }[] = [];
  const asked: string[] = [];
  const log: string[] = [];
  const io: Io = {
    cwd: mkdtempSync(join(tmpdir(), 'create-site-')),
    env: {},
    interactive,
    async ask(q, fallback) {
      asked.push(q);
      const hit = Object.entries(answers).find(([k]) => q.startsWith(k));
      return hit ? hit[1] : (fallback ?? '');
    },
    log: (l) => log.push(l),
    async run(cmd, args, opts) {
      runs.push({ cmd, args, ...(opts.env ? { env: opts.env } : {}) });
      return 0;
    },
  };
  return { io, runs, asked, log };
}

/** wrangler.jsonc, comments removed (none sit inside strings in the template). */
const jsonc = (text: string) => JSON.parse(text.replace(/^\s*\/\/.*$/gm, ''));

test('writes a site that runs on @contentworker/frontend, unattended', async () => {
  const { io, runs } = fakeIo();
  const code = await create(['shop', '--yes', '--delivery', DELIVERY, '--key', 'cda-1'], io);
  assert.equal(code, 0);
  const root = join(io.cwd, 'shop');
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'shop');
  assert.equal(pkg.dependencies['@contentworker/frontend'], FRONTEND_RANGE);
  const w = jsonc(readFileSync(join(root, 'wrangler.jsonc'), 'utf8'));
  assert.equal(w.main, 'node_modules/@contentworker/frontend/src/entry.ts');
  assert.equal(w.vars.CONTENTWORKER, DELIVERY);
  assert.equal(w.vars.CONTENTWORKER_LOCALE, 'en-US');
  assert.equal(w.vars.SITE_ORIGIN, undefined);
  const devVars = readFileSync(join(root, '.dev.vars'), 'utf8');
  assert.match(devVars, /^CONTENTWORKER_KEY=cda-1$/m);
  assert.equal(statSync(join(root, '.dev.vars')).mode & 0o777, 0o600);
  assert.match(readFileSync(join(root, '.gitignore'), 'utf8'), /^\.dev\.vars$/m);
  assert.ok(
    !readFileSync(join(root, 'wrangler.jsonc'), 'utf8').includes('cda-1'),
    'no key in config',
  );
  assert.deepEqual(
    runs.map((r) => r.cmd),
    ['npm'],
    'installs, seeds nothing without a CMA key',
  );
});

test('a Management key seeds the space; with an origin it registers the purge webhook too', async () => {
  const { io, runs } = fakeIo();
  const argv = [
    's',
    '--yes',
    '--delivery',
    DELIVERY,
    '--cma-key',
    'cma-1',
    '--origin',
    'https://www.example.com/x',
  ];
  assert.equal(await create(argv, io), 0);
  const seed = runs.find((r) => r.args.includes('seed'));
  assert.ok(seed, 'ran the seed');
  assert.equal(seed.env?.CONTENTWORKER_API, 'https://api.example.com');
  assert.equal(seed.env?.CONTENTWORKER_CMA_KEY, 'cma-1');
  const i = seed.args.indexOf('--webhook');
  assert.equal(seed.args[i + 1], 'https://www.example.com/__cw/webhook');
  const secret = seed.args[seed.args.indexOf('--webhook-secret') + 1] ?? '';
  assert.match(secret, /^[0-9a-f]{64}$/);
  const devVars = readFileSync(join(io.cwd, 's', '.dev.vars'), 'utf8');
  assert.match(devVars, new RegExp(`^CONTENTWORKER_WEBHOOK_SECRET=${secret}$`, 'm'));
  const w = jsonc(readFileSync(join(io.cwd, 's', 'wrangler.jsonc'), 'utf8'));
  assert.equal(w.vars.SITE_ORIGIN, 'https://www.example.com');
});

test('prompts on a terminal, flags first', async () => {
  const { io, asked } = fakeIo(
    { 'Delivery URL': DELIVERY, 'Content Delivery': 'k', 'Default locale': 'de-DE' },
    true,
  );
  assert.equal(await create(['site', '--no-install', '--origin', 'https://example.com'], io), 0);
  assert.ok(
    !asked.some((q) => q.startsWith("The site's public origin")),
    'a flag skips its prompt',
  );
  const w = jsonc(readFileSync(join(io.cwd, 'site', 'wrangler.jsonc'), 'utf8'));
  assert.equal(w.vars.CONTENTWORKER_LOCALE, 'de-DE');
});

test('refuses a non-empty directory, a missing or malformed Delivery URL, and unknown options', async () => {
  const { io } = fakeIo();
  mkdirSync(join(io.cwd, 'taken'));
  writeFileSync(join(io.cwd, 'taken', 'x'), '');
  await assert.rejects(create(['taken', '--yes', '--delivery', DELIVERY], io), UsageError);
  await assert.rejects(create(['a', '--yes'], io), /--delivery is required/);
  await assert.rejects(
    create(['b', '--yes', '--delivery', 'http://cdn.example.com/s/e'], io),
    /https/,
  );
  await assert.rejects(
    create(['c', '--yes', '--delivery', 'https://cdn.example.com/s'], io),
    /<space>\/<env>/,
  );
  await assert.rejects(create(['d', '--frob'], io), /Unknown option --frob/);
});

test('a bare -- separator is ignored, as npx passes it through', async () => {
  const { io } = fakeIo();
  assert.equal(await create(['sep', '--', '--yes', '--no-install', '--delivery', DELIVERY], io), 0);
  assert.ok(readFileSync(join(io.cwd, 'sep', 'wrangler.jsonc'), 'utf8').length > 0);
});

test('helpers: Delivery URLs, the api origin, Worker names', () => {
  assert.equal(
    checkDelivery('https://cdn.example.com/delivery/s/e/'),
    'https://cdn.example.com/s/e',
  );
  assert.equal(checkDelivery('http://localhost:8788/s/e'), 'http://localhost:8788/s/e');
  assert.equal(apiOrigin('https://cdn.example.com/s/e'), 'https://api.example.com');
  assert.equal(workerName('/tmp/My Site!'), 'my-site');
});

test('templates stay in step with the runtime and the showcase site', () => {
  const frontend = JSON.parse(readFileSync(join(repo, 'packages/frontend/package.json'), 'utf8'));
  assert.equal(FRONTEND_RANGE, `^${frontend.version}`, 'new sites get the current runtime');
  const root = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
  assert.equal(WRANGLER_RANGE, `^${root.devDependencies.wrangler}`);
  const showcase = jsonc(readFileSync(join(repo, 'wrangler.jsonc'), 'utf8'));
  assert.equal(COMPATIBILITY_DATE, showcase.compatibility_date);
});
