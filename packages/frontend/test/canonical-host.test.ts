import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hostRedirect } from '../src/host.ts';

const at = (href: string, method = 'GET') => {
  const url = new URL(href);
  return hostRedirect(new Request(url, { method }), url, 'https://contentworker.site');
};

test('the www twin redirects to the canonical host, path and query kept', () => {
  const res = at('https://www.contentworker.site/blog/why?utm=x');
  assert.equal(res?.status, 301);
  assert.equal(res?.headers.get('location'), 'https://contentworker.site/blog/why?utm=x');
});

test('a non-GET request keeps its method with a 308', () => {
  assert.equal(at('https://www.contentworker.site/__cw/webhook', 'POST')?.status, 308);
  assert.equal(at('https://www.contentworker.site/', 'HEAD')?.status, 301);
});

test('the canonical host, workers.dev, previews and local hosts are left alone', () => {
  for (const href of [
    'https://contentworker.site/',
    'https://contentworker-site.example.workers.dev/',
    'https://abc123-contentworker-site.example.workers.dev/',
    'http://127.0.0.1:8790/',
    'http://localhost:8787/',
    'https://docs.contentworker.site/',
  ])
    assert.equal(at(href), null, href);
});

test('a www canonical host pulls the bare host to it', () => {
  const url = new URL('https://example.com/a');
  const res = hostRedirect(new Request(url), url, 'https://www.example.com');
  assert.equal(res?.headers.get('location'), 'https://www.example.com/a');
});

test('no SITE_ORIGIN, or a malformed one, redirects nothing', () => {
  const url = new URL('https://www.contentworker.site/');
  assert.equal(hostRedirect(new Request(url), url, undefined), null);
  assert.equal(hostRedirect(new Request(url), url, 'not a url'), null);
});
