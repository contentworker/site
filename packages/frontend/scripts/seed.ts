#!/usr/bin/env node
// Seeds a ContentWorker space with the runtime's content model and the starter content.
//
//   CONTENTWORKER_API=https://api.<your domain> \
//   CONTENTWORKER=<space>/<env> \
//   CONTENTWORKER_CMA_KEY=<content management key> \
//   npm run seed -- [--dry-run] [--force] [--webhook https://<site>/__cw/webhook --webhook-secret <secret>]
//
// --dry-run reads the space and prints what it would create, changing nothing.
import { CONTENT_TYPES } from '../content-model/model.ts';
import { seed } from '../content-model/seed.ts';
import { starterContent } from '../content-model/starter-content.ts';
import { TOPICS } from '../src/webhook.ts';
import { png } from './png.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const api = process.env.CONTENTWORKER_API;
const token = process.env.CONTENTWORKER_CMA_KEY;
const ns = (process.env.CONTENTWORKER ?? '').replace(/^https?:\/\/[^/]+\/(delivery\/)?/, '');
const [space, environment] = ns.split('/');
if (!api || !token || !space || !environment) {
  console.error(
    'Set CONTENTWORKER_API (https://api.<domain>), CONTENTWORKER (<space>/<env>) and CONTENTWORKER_CMA_KEY.',
  );
  process.exit(1);
}
const webhookUrl = option('webhook');
const webhookSecret = option('webhook-secret');
if (webhookUrl && !webhookSecret) {
  console.error(
    '--webhook needs --webhook-secret (the same value as the site’s CONTENTWORKER_WEBHOOK_SECRET).',
  );
  process.exit(1);
}

const report = await seed({
  api,
  space,
  environment,
  token,
  locale: process.env.CONTENTWORKER_LOCALE || 'en-US',
  model: CONTENT_TYPES,
  content: starterContent,
  image: (w, h, s) => Uint8Array.from(png(w, h, s)),
  ...(webhookUrl && webhookSecret
    ? { webhook: { url: webhookUrl, secret: webhookSecret, topics: TOPICS } }
    : {}),
  dryRun: flag('dry-run'),
  force: flag('force'),
  log: (line) => console.log(line),
});
console.log(JSON.stringify(report, null, 2));
