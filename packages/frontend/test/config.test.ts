import assert from 'node:assert/strict';
import { test } from 'node:test';
import { backend, ConfigError } from '../src/config.ts';

const binding = { fetch: async () => new Response('{}') };

test('HTTP: a full Delivery URL names host, space and environment', () => {
  const cw = backend({
    CONTENTWORKER: 'https://cdn.acme.example/acme/main',
    CONTENTWORKER_KEY: 'k',
  });
  assert.equal(cw.transport, 'http');
  assert.equal(cw.base, 'https://cdn.acme.example/delivery/acme/main');
  assert.equal(cw.locale, 'en-US');
  // A pasted /delivery/ path and a trailing slash are fine too.
  assert.equal(
    backend({
      CONTENTWORKER: 'https://cdn.acme.example/delivery/acme/main/',
      CONTENTWORKER_KEY: 'k',
    }).base,
    'https://cdn.acme.example/delivery/acme/main',
  );
});

test('binding: the bare namespace plus CONTENTWORKER_DELIVERY', () => {
  const cw = backend({
    CONTENTWORKER: 'acme/staging',
    CONTENTWORKER_DELIVERY: binding,
    CONTENTWORKER_KEY: 'k',
    CONTENTWORKER_LOCALE: 'de-DE',
  });
  assert.equal(cw.transport, 'binding');
  assert.equal(cw.base, 'https://contentworker.internal/delivery/acme/staging');
  assert.equal(cw.locale, 'de-DE');
});

test('a binding wins over a URL', () => {
  const cw = backend({
    CONTENTWORKER: 'https://cdn.acme.example/acme/main',
    CONTENTWORKER_DELIVERY: binding,
    CONTENTWORKER_KEY: 'k',
  });
  assert.equal(cw.transport, 'binding');
});

test('misconfiguration says what to fix', () => {
  const bad: [Record<string, unknown>, RegExp][] = [
    [{ CONTENTWORKER_KEY: 'k' }, /Set CONTENTWORKER/],
    [
      { CONTENTWORKER: 'acme', CONTENTWORKER_DELIVERY: binding, CONTENTWORKER_KEY: 'k' },
      /"<space>\/<env>"/,
    ],
    [
      { CONTENTWORKER: 'acme/main/extra', CONTENTWORKER_DELIVERY: binding, CONTENTWORKER_KEY: 'k' },
      /"<space>\/<env>"/,
    ],
    [
      { CONTENTWORKER: 'acme/main', CONTENTWORKER_KEY: 'k' },
      /no CONTENTWORKER_DELIVERY service binding/,
    ],
    [{ CONTENTWORKER: 'https://cdn.acme.example/acme/main' }, /CONTENTWORKER_KEY/],
  ];
  for (const [env, message] of bad) {
    assert.throws(
      () => backend(env),
      (e) => e instanceof ConfigError && message.test(e.message),
    );
  }
});

test('admin origin: derived from cdn.<domain> or api.<domain>, or set; https only, never a wildcard', () => {
  const k = { CONTENTWORKER_KEY: 'k' };
  assert.equal(
    backend({ CONTENTWORKER: 'https://cdn.acme.example/acme/main', ...k }).admin,
    'https://acme.example',
  );
  assert.equal(
    backend({
      CONTENTWORKER: 'acme/main',
      CONTENTWORKER_DELIVERY: binding,
      CONTENTWORKER_PREVIEW: 'https://api.acme.example',
      ...k,
    }).admin,
    'https://acme.example',
  );
  assert.equal(
    backend({ CONTENTWORKER: 'acme/main', CONTENTWORKER_DELIVERY: binding, ...k }).admin,
    null,
  );
  assert.equal(
    backend({
      CONTENTWORKER: 'https://cdn.acme.example/acme/main',
      CONTENTWORKER_ADMIN: 'https://studio.acme.example/',
      ...k,
    }).admin,
    'https://studio.acme.example',
  );
  assert.equal(
    backend({
      CONTENTWORKER: 'acme/main',
      CONTENTWORKER_DELIVERY: binding,
      CONTENTWORKER_ADMIN: 'http://localhost:5173',
      ...k,
    }).admin,
    'http://localhost:5173',
  );
  for (const bad of [
    '*',
    'https://*.acme.example',
    'http://acme.example',
    'https://acme.example/admin',
    'acme.example',
  ]) {
    assert.throws(
      () =>
        backend({
          CONTENTWORKER: 'acme/main',
          CONTENTWORKER_DELIVERY: binding,
          CONTENTWORKER_ADMIN: bad,
          ...k,
        }),
      ConfigError,
      bad,
    );
  }
});
