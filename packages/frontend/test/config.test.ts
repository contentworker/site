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
