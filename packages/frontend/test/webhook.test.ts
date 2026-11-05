import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { tagsForEvent, verifySignature } from '../src/webhook.ts';
import worker, { Site } from '../src/worker.ts';
import { env, world } from './fixtures.ts';

const SECRET = 'whsec_test';
const sign = (body: string, timestamp: string, secret = SECRET) =>
  `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;

function delivery(
  event: Record<string, unknown> & { type: string },
  {
    secret = SECRET,
    timestamp = new Date().toISOString(),
    signature,
  }: { secret?: string; timestamp?: string; signature?: string } = {},
) {
  const body = JSON.stringify(event);
  return new Request('https://contentworker.site/__cw/webhook', {
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/json',
      'x-contentworker-event': event.type,
      'x-contentworker-timestamp': timestamp,
      'x-contentworker-signature': signature ?? sign(body, timestamp, secret),
    },
  });
}

async function post(request: Request, overrides: Record<string, unknown> = {}) {
  const e = env({ CONTENTWORKER_WEBHOOK_SECRET: SECRET, ...overrides });
  const w = await world(Site, e);
  const res = await worker.fetch(request, e, w.ctx);
  return { res, enqueued: w.enqueued };
}

test('a signed entry.published enqueues the entry tag and cached 404s', async () => {
  const { res, enqueued } = await post(
    delivery({
      id: 'ev1',
      type: 'entry.published',
      entryId: 'p-about',
      contentTypeApiId: 'page',
      occurredAt: new Date().toISOString(),
    }),
  );
  assert.equal(res.status, 200);
  assert.deepEqual(enqueued, [['e:p-about', 'notfound', 'type:page']]);
});

test('bad signatures, stale timestamps and missing secrets are refused', async () => {
  const event = { id: 'ev1', type: 'entry.published', entryId: 'x' };
  assert.equal((await post(delivery(event, { secret: 'wrong' }))).res.status, 401);
  const old = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  assert.equal((await post(delivery(event, { timestamp: old }))).res.status, 401);
  assert.equal((await post(delivery(event, { signature: 'sha256=zz' }))).res.status, 401);
  assert.equal(
    (await post(delivery(event), { CONTENTWORKER_WEBHOOK_SECRET: undefined })).res.status,
    404,
  );
  const get = await post(new Request('https://contentworker.site/__cw/webhook'));
  assert.equal(get.res.status, 405);
});

test('events map to tags', () => {
  assert.deepEqual(
    tagsForEvent({ type: 'entry.unpublished', entryId: 'a', contentTypeApiId: 'redirect' }),
    ['e:a', 'type:redirect'],
  );
  assert.deepEqual(tagsForEvent({ type: 'entry.published', entryId: 'a' }), ['e:a', 'notfound']);
  assert.deepEqual(tagsForEvent({ type: 'asset.rights_changed', assetId: 'x' }), ['e:x']);
  for (const type of [
    'entries.published_bulk',
    'content_type.published',
    'release.published',
    'environment_alias.changed',
  ]) {
    assert.deepEqual(tagsForEvent({ type }), ['site'], type);
  }
  assert.deepEqual(tagsForEvent({ type: 'redirects.changed' }), ['redirects', 'notfound']);
  assert.deepEqual(tagsForEvent({ type: 'asset.ingested' }), []);
});

test('verifySignature is exact about the signed bytes', async () => {
  const timestamp = new Date().toISOString();
  const body = '{"a":1}';
  assert.equal(
    await verifySignature({ secret: SECRET, body, timestamp, signature: sign(body, timestamp) }),
    true,
  );
  assert.equal(
    await verifySignature({
      secret: SECRET,
      body: '{"a":2}',
      timestamp,
      signature: sign(body, timestamp),
    }),
    false,
  );
});
