#!/usr/bin/env node
// A local ContentWorker Delivery API and media origin over the test fixtures, for measuring the
// real site Worker (wrangler dev) with Lighthouse, deterministically and offline.
//   node scripts/mock-delivery.ts [port] [starter]   → http://localhost:<port>/delivery/site/main/…
// With `starter`, it serves the starter content (what contentworker.site shows) instead of the
// test fixtures.
// Images are generated PNGs at the requested ladder width (2:1, like the fixtures).
import { createServer } from 'node:http';
import { fakeDelivery } from '../test/fixtures.ts';
import { starterByType } from '../test/starter-delivered.ts';
import { png } from './png.ts';

const port = Number(process.argv[2] ?? 8788);
const origin = `http://localhost:${port}`;
const delivery = fakeDelivery(process.argv[3] === 'starter' ? { extra: starterByType() } : {});

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', origin);
  if (url.pathname.startsWith('/delivery/')) {
    const upstream = await delivery.fetch(`https://cdn.example${url.pathname}${url.search}`);
    // Point the fixtures' media and stream hosts at this server.
    const body = (await upstream.text())
      .replaceAll('https://media.example', `${origin}/media`)
      .replaceAll('https://stream.example', `${origin}/media`);
    res.writeHead(upstream.status, { 'content-type': 'application/json' });
    res.end(body);
    return;
  }
  if (url.pathname.startsWith('/media/')) {
    const variant = url.pathname.split('/')[3] ?? 'o';
    const w = /^w(\d+)$/.exec(variant)?.[1];
    const [width, height] = w
      ? [Number(w), Number(w) / 2]
      : variant === 'r-og'
        ? [1200, 630]
        : [1280, 640];
    const seed = [...url.pathname].reduce((n, ch) => n + ch.charCodeAt(0), 0);
    res.writeHead(200, {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=31536000, immutable',
      'access-control-allow-origin': '*',
    });
    res.end(png(width, height, seed));
    return;
  }
  res.writeHead(404).end();
}).listen(port, () => console.log(`mock delivery on ${origin}`));
