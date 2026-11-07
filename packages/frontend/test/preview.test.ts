import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { HANDOFF_SCRIPT } from '../src/preview.ts';
import { ADMIN, call, post } from './support/preview.ts';

const LEGACY_CLEAR = 'cw_preview=; Path=/__preview; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
/** A grant: the old unpartitioned cookie cleared first, then the partitioned one set. */
function assertGrantCookies(res: Response) {
  const cookies = res.headers.getSetCookie();
  assert.equal(cookies.length, 2);
  assert.equal(cookies[0], LEGACY_CLEAR);
  assert.match(cookies[1] ?? '', COOKIE);
}

const COOKIE =
  /^cw_preview=p-about~pw_good; Path=\/__preview; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=3600$/;

/** The headers every /__preview response carries. */
function assertPreviewHeaders(res: Response, admin = ADMIN) {
  const csp = res.headers.get('content-security-policy') ?? '';
  assert.match(csp, new RegExp(`frame-ancestors ${admin.replace(/[.']/g, '\\$&')}(;|$)`));
  assert.doesNotMatch(csp, /frame-ancestors[^;]*('self'|\*)/);
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(res.headers.get('x-robots-tag'), 'noindex');
  assert.match(res.headers.get('cache-control') ?? '', /no-store/);
}

test('a ?token= link sets a partitioned, framable cookie and redirects to the draft path', async () => {
  const { res } = await call('/__preview?entry=p-about&token=pw_good');
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/__preview/about');
  assertGrantCookies(res);
  assertPreviewHeaders(res);
});

test('a live preview session carries through the redirect', async () => {
  const { res } = await call('/__preview?entry=p-about&token=pw_good&cw_session=sess_12345678');
  assert.equal(res.headers.get('location'), '/__preview/about?cw_session=sess_12345678');
  // A malformed session is dropped, never echoed.
  const odd = await call('/__preview?entry=p-about&token=pw_good&cw_session=%3Cx%3E');
  assert.equal(odd.res.headers.get('location'), '/__preview/about');
});

test('an invalid or expired token is refused; a malformed entry is a 400', async () => {
  assert.equal((await call('/__preview?entry=p-about&token=pw_bad')).res.status, 403);
  assert.equal((await call('/__preview?entry=p~x&token=pw_good')).res.status, 400);
  assert.equal((await call('/__preview?token=pw_good')).res.status, 400);
  assert.equal((await call('/__preview')).res.status, 400);
});

test('without ?token=, the link answers the fragment handoff page', async () => {
  const { res, body, previewCalls } = await call('/__preview?entry=p-about');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /^text\/html/);
  assertPreviewHeaders(res);
  assert.equal(res.headers.get('cache-tag'), null);
  assert.match(body, /<meta name="robots" content="noindex">/);
  assert.match(body, /<meta name="referrer" content="no-referrer">/);
  assert.ok(body.includes(`<script>${HANDOFF_SCRIPT}</script>`));
  // Nothing from the request is printed into the page, and nothing was checked yet.
  assert.doesNotMatch(body, /p-about/);
  assert.equal(previewCalls.length, 0);
  // The page is small: one round trip, well inside any script budget.
  assert.ok(Buffer.byteLength(body) < 2048, `handoff page is ${Buffer.byteLength(body)} B`);
});

/** Runs the handoff script against a fake window; returns what it did, in order. */
async function runHandoff(href: string, answer: { status: number; json?: unknown }) {
  const url = new URL(href);
  const log: unknown[] = [];
  const status = { textContent: '' };
  const location = {
    search: url.search,
    hash: url.hash,
    pathname: url.pathname,
    replace: (to: string) => log.push(['replace', to]),
  };
  const sandbox = {
    URLSearchParams,
    JSON,
    Promise,
    location,
    document: { getElementById: (id: string) => (id === 'cw-status' ? status : null) },
    history: {
      replaceState: (_s: unknown, _t: string, to: string) => {
        location.hash = '';
        log.push(['replaceState', to]);
      },
    },
    fetch: async (to: string, init: RequestInit) => {
      log.push(['fetch', to, { ...init, body: JSON.parse(String(init.body)) }]);
      return {
        ok: answer.status === 200,
        status: answer.status,
        json: async () => answer.json,
      };
    },
  };
  runInNewContext(HANDOFF_SCRIPT, sandbox);
  await new Promise((r) => setTimeout(r, 10));
  return { log, status: status.textContent };
}

test('the handoff script drops the fragment first, posts the token, and follows the answer', async () => {
  const { log } = await runHandoff(
    `${'https://contentworker.site'}/__preview?entry=p-about&cw_session=sess_12345678#token=pw_good`,
    { status: 200, json: { location: '/__preview/about?cw_session=sess_12345678' } },
  );
  assert.deepEqual(log[0], ['replaceState', '/__preview?entry=p-about&cw_session=sess_12345678']);
  const [, to, init] = log[1] as [string, string, RequestInit & { body: unknown }];
  assert.equal(to, '/__preview');
  assert.equal(init.method, 'POST');
  // Preview pages send no Referer, which would blank Origin on the POST; this keeps it.
  assert.equal(init.referrerPolicy, 'same-origin');
  assert.equal(init.credentials, 'same-origin');
  assert.deepEqual(init.body, { entry: 'p-about', token: 'pw_good', session: 'sess_12345678' });
  assert.deepEqual(log[2], ['replace', '/__preview/about?cw_session=sess_12345678']);
});

test('the handoff script refuses to go anywhere but /__preview/, and says why it stopped', async () => {
  const away = await runHandoff(
    'https://contentworker.site/__preview?entry=p-about#token=pw_good',
    {
      status: 200,
      json: { location: 'https://evil.example/' },
    },
  );
  assert.equal(away.log.length, 2, 'no navigation');
  assert.match(away.status, /could not start/);
  const expired = await runHandoff(
    'https://contentworker.site/__preview?entry=p-about#token=pw_bad',
    { status: 403 },
  );
  assert.match(expired.status, /invalid or has expired/);
  const none = await runHandoff('https://contentworker.site/__preview?entry=p-about', {
    status: 200,
  });
  assert.deepEqual(
    none.log.map((l) => (l as string[])[0]),
    ['replaceState'],
  );
  assert.match(none.status, /no token/);
});

test('POST /__preview trades a token for the cookie and answers where to go', async () => {
  const { res, body } = await post('/__preview', {
    entry: 'p-about',
    token: 'pw_good',
    session: 'sess_12345678',
  });
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(body), { location: '/__preview/about?cw_session=sess_12345678' });
  assertGrantCookies(res);
  assert.match(res.headers.get('content-type') ?? '', /^application\/json/);
  assertPreviewHeaders(res);
  const bad = await post('/__preview', { entry: 'p-about', token: 'pw_bad' });
  assert.equal(bad.res.status, 403);
  assert.equal(bad.res.headers.get('set-cookie'), null);
});

test('POST /__preview takes same-origin JSON only, and only a little of it', async () => {
  const grant = { entry: 'p-about', token: 'pw_good' };
  const status = async (headers: Record<string, string>, body: unknown = grant) =>
    (await post('/__preview', body, { headers })).res.status;
  assert.equal(await status({ origin: 'https://evil.example' }), 403);
  assert.equal(await status({ origin: 'null' }), 403);
  assert.equal(await status({ origin: ADMIN }), 403, 'not even the admin');
  assert.equal(await status({ 'sec-fetch-site': 'cross-site' }), 403);
  // No Origin at all (a request no browser page made) is refused too.
  const bare = await call('/__preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(grant),
  });
  assert.equal(bare.res.status, 403);
  assert.equal(await status({ 'content-type': 'text/plain' }), 415);
  assert.equal(await status({}, { ...grant, pad: 'x'.repeat(5000) }), 413);
  assert.equal(await status({}, '[1]'), 400);
  assert.equal(await status({}, '{nope'), 400);
});

test('the draft renders under /__preview: uncached, noindex, framable by the admin only', async () => {
  const { res, body } = await call('/__preview/about', { cookie: 'cw_preview=p-about~pw_good' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  assert.equal(res.headers.get('cache-tag'), null);
  assertPreviewHeaders(res);
  // Only a live page (cw_session) may create the cw-preview Trusted Types policy.
  assert.match(res.headers.get('content-security-policy') ?? '', /trusted-types loader(;|$)/);
  assert.match(body, /<h1[^>]*>About \(draft\)<\/h1><p>Unpublished words.<\/p>/);
  assert.match(body, /<meta name="robots" content="noindex">/);
  assert.doesNotMatch(body, /rel="canonical"/);
  assert.match(body, /class="preview-bar".*href="\/__preview\/exit\?to=%2Fabout"/);
});

test('public pages keep refusing every frame but their own, and keep their Referer policy', async () => {
  const { res } = await call('/about');
  const csp = res.headers.get('content-security-policy') ?? '';
  assert.match(csp, /frame-ancestors 'self'/);
  assert.doesNotMatch(csp, /example|cw-preview/);
  assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
});

test('with no admin origin to be found, preview pages can be framed by nobody', async () => {
  const env = {
    CONTENTWORKER: 'site/main',
    CONTENTWORKER_PREVIEW: 'https://preview-host.example',
  };
  const { res } = await call('/__preview?entry=p-about', { env });
  assert.match(res.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
  const named = await call('/__preview?entry=p-about', {
    env: { ...env, CONTENTWORKER_ADMIN: 'https://admin.acme.example' },
  });
  assertPreviewHeaders(named.res, 'https://admin.acme.example');
});

test('other paths under /__preview show published content; exit clears the cookie', async () => {
  const { body } = await call('/__preview/', { cookie: 'cw_preview=p-about~pw_good' });
  assert.match(body, /Content, at the edge/);
  const exit = await call('/__preview/exit?to=/about');
  assert.equal(exit.res.headers.get('location'), '/about');
  const cleared = exit.res.headers.getSetCookie();
  assert.equal(cleared[0], LEGACY_CLEAR);
  assert.match(cleared[1] ?? '', /^cw_preview=; .*SameSite=None; Partitioned; Max-Age=0$/);
  assert.equal((await call('/__preview/exit?to=//evil.example')).res.headers.get('location'), '/');
});

test('POST anywhere else stays refused', async () => {
  assert.equal((await post('/about', {})).res.status, 405);
  assert.equal((await post('/__preview/about', {})).res.status, 405);
});

test('the gateway stamps its nonce on the handoff script and keeps the preview policy', async () => {
  class FakeRewriter {
    handler?: { element(el: { setAttribute(k: string, v: string): void }): void };
    on(_selector: string, handler: FakeRewriter['handler']) {
      this.handler = handler;
      return this;
    }
    transform(res: Response) {
      this.handler?.element({ setAttribute: () => {} });
      return new Response(res.body, res);
    }
  }
  const g = globalThis as { HTMLRewriter?: unknown };
  g.HTMLRewriter = FakeRewriter;
  try {
    const { res } = await call('/__preview?entry=p-about');
    const csp = res.headers.get('content-security-policy') ?? '';
    assert.match(csp, /^script-src 'nonce-[^']+' 'strict-dynamic' 'self'; /);
    assert.match(csp, /frame-ancestors https:\/\/example(;|$)/);
    assert.match(csp, /require-trusted-types-for 'script'/);
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  } finally {
    delete g.HTMLRewriter;
  }
});

test('exit only ever goes to a path on this site', async () => {
  const to = async (q: string) =>
    (await call(`/__preview/exit?to=${q}`)).res.headers.get('location');
  assert.equal(await to(encodeURIComponent('/about?x=1#top')), '/about?x=1#top');
  assert.equal(await to('/%5Cevil.example'), '/');
  assert.equal(await to('/%09/evil.example'), '/');
  assert.equal(await to('https://evil.example/'), '/');
  assert.equal(await to('javascript:alert(1)'), '/');
  assert.equal(await to('/.//evil.example'), '/');
});

test('a ?token= link sets the cookie only for a navigation, never a subresource', async () => {
  const link = '/__preview?entry=p-about&token=pw_good';
  for (const dest of ['image', 'script', 'empty', 'style']) {
    const { res, previewCalls } = await call(link, { headers: { 'sec-fetch-dest': dest } });
    assert.equal(res.status, 403, dest);
    assert.deepEqual(res.headers.getSetCookie(), [], dest);
    assert.equal(previewCalls.length, 0, dest);
  }
  for (const dest of ['document', 'iframe']) {
    const { res } = await call(link, { headers: { 'sec-fetch-dest': dest } });
    assert.equal(res.status, 303, dest);
    assertGrantCookies(res);
  }
});

test('an admin origin that is the site itself frames nothing', async () => {
  const self = await call('/__preview?entry=p-about', {
    env: { CONTENTWORKER: 'https://cdn.contentworker.site/site/main' },
  });
  assert.match(self.res.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
  const named = await call('/__preview?entry=p-about', {
    env: { CONTENTWORKER_ADMIN: 'https://contentworker.site' },
  });
  assert.match(named.res.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
});

test('a malformed CONTENTWORKER_ADMIN disables framing instead of breaking pages', async () => {
  const env = { CONTENTWORKER_ADMIN: 'not an origin' };
  const page = await call('/about', { env });
  assert.equal(page.res.status, 200);
  const preview = await call('/__preview?entry=p-about', { env });
  assert.equal(preview.res.status, 200);
  assert.match(preview.res.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
  const normalised = await call('/__preview?entry=p-about', {
    env: { CONTENTWORKER_ADMIN: 'https://Admin.ACME.example:443/' },
  });
  assertPreviewHeaders(normalised.res, 'https://admin.acme.example');
});

test('with an old unpartitioned grant beside the new one, the draft for the path wins', async () => {
  const cookie = 'cw_preview=p-inline~pw_good; cw_preview=p-about~pw_good';
  const { body } = await call('/__preview/about', { cookie });
  assert.match(body, /About \(draft\)/);
  const inline = await call('/__preview/inline', { cookie });
  assert.match(inline.body, /data-cw-block="k-hero"/);
});

test('a live preview page allows the cw-preview policy and drops the exit link', async () => {
  const { res, body } = await call('/__preview/inline?cw_session=sess_12345678', {
    cookie: 'cw_preview=p-inline~pw_good',
  });
  assert.match(res.headers.get('content-security-policy') ?? '', /trusted-types loader cw-preview/);
  assert.match(body, /<div class="preview-bar" role="status">Previewing a draft.<\/div>/);
  assert.doesNotMatch(body, /__preview\/exit/);
});
