import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { HANDOFF_SCRIPT } from '../src/preview.ts';
import { ADMIN, call, post, SITE } from './support/preview.ts';

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
function assertPreviewHeaders(res: Response, admin = ADMIN, referrer = 'no-referrer') {
  const csp = res.headers.get('content-security-policy') ?? '';
  assert.match(csp, new RegExp(`frame-ancestors ${admin.replace(/[.']/g, '\\$&')}(;|$)`));
  assert.doesNotMatch(csp, /frame-ancestors[^;]*('self'|\*)/);
  assert.equal(res.headers.get('referrer-policy'), referrer);
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
  // Same-origin Referer, so its form POST carries Origin; nothing goes to another site.
  assertPreviewHeaders(res, ADMIN, 'same-origin');
  assert.equal(res.headers.get('cache-tag'), null);
  assert.match(body, /<meta name="robots" content="noindex">/);
  assert.match(
    body,
    /<form method="post" action="\/__preview" hidden><input type="hidden" name="entry"><input type="hidden" name="token"><\/form>/,
  );
  assert.ok(body.includes(`<script>${HANDOFF_SCRIPT}</script>`));
  // Nothing from the request is printed into the page, and nothing was checked yet.
  assert.doesNotMatch(body, /p-about/);
  assert.equal(previewCalls.length, 0);
  // The page is small: one round trip, well inside any script budget.
  assert.ok(Buffer.byteLength(body) < 2048, `handoff page is ${Buffer.byteLength(body)} B`);
});

/** Runs the handoff script against a fake window; returns what it did, in order. */
function runHandoff(href: string) {
  const url = new URL(href);
  const log: unknown[] = [];
  const status = { textContent: '' };
  const inputs: Record<string, { value: string }> = { entry: { value: '' }, token: { value: '' } };
  const location = { search: url.search, hash: url.hash, pathname: url.pathname };
  const form = {
    elements: { namedItem: (name: string) => inputs[name] },
    submit: () => log.push(['submit', { entry: inputs.entry?.value, token: inputs.token?.value }]),
  };
  runInNewContext(HANDOFF_SCRIPT, {
    URLSearchParams,
    location,
    document: {
      forms: [form],
      getElementById: (id: string) => (id === 'cw-status' ? status : null),
    },
    history: {
      replaceState: (_s: unknown, _t: string, to: string) => {
        location.hash = '';
        log.push(['replaceState', to]);
      },
    },
  });
  return { log, status: status.textContent };
}

test('the handoff script drops the fragment first, then submits the token in its form', () => {
  const { log } = runHandoff(
    'https://contentworker.site/__preview?entry=p-about&x=1#token=pw_good',
  );
  assert.deepEqual(log, [
    ['replaceState', '/__preview?entry=p-about&x=1'],
    ['submit', { entry: 'p-about', token: 'pw_good' }],
  ]);
});

test('without a token in the fragment, the handoff says so and submits nothing', () => {
  const { log, status } = runHandoff('https://contentworker.site/__preview?entry=p-about');
  assert.deepEqual(log, [['replaceState', '/__preview?entry=p-about']]);
  assert.match(status, /no token/);
});

/** The handoff form's POST, as the browser sends it from the handoff page. */
function postForm(fields: Record<string, string>, headers: Record<string, string> = {}) {
  return call('/__preview', {
    method: 'POST',
    headers: {
      origin: SITE,
      'sec-fetch-site': 'same-origin',
      'sec-fetch-dest': 'iframe',
      'content-type': 'application/x-www-form-urlencoded',
      ...headers,
    },
    body: new URLSearchParams(fields).toString(),
  });
}

test('POST /__preview trades the token for the cookie and redirects to the draft', async () => {
  const { res } = await postForm({ entry: 'p-about', token: 'pw_good' });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/__preview/about');
  assertGrantCookies(res);
  assertPreviewHeaders(res);
  const bad = await postForm({ entry: 'p-about', token: 'pw_bad' });
  assert.equal(bad.res.status, 403);
  assert.deepEqual(bad.res.headers.getSetCookie(), []);
});

test("POST /__preview takes this site's own form only, from a navigation, and only a little", async () => {
  const grant = { entry: 'p-about', token: 'pw_good' };
  const status = async (headers: Record<string, string>, fields: Record<string, string> = grant) =>
    (await postForm(fields, headers)).res.status;
  assert.equal(await status({ origin: 'https://evil.example' }), 403);
  assert.equal(await status({ origin: 'null' }), 403);
  assert.equal(await status({ origin: ADMIN }), 403, 'not even the admin');
  assert.equal(await status({ 'sec-fetch-site': 'cross-site' }), 403);
  assert.equal(await status({ 'sec-fetch-dest': 'empty' }), 403, 'a fetch, not a navigation');
  assert.equal(await status({ 'content-type': 'application/json' }), 415);
  assert.equal(await status({}, { ...grant, pad: 'x'.repeat(5000) }), 413);
  // No Origin at all (a request no browser page made) is refused too.
  const bare = await call('/__preview', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(grant).toString(),
  });
  assert.equal(bare.res.status, 403);
});

test('the draft renders under /__preview: uncached, noindex, framable by the admin only', async () => {
  const { res, body } = await call('/__preview/about', { cookie: 'cw_preview=p-about~pw_good' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  assert.equal(res.headers.get('cache-tag'), null);
  assertPreviewHeaders(res);
  // A page showing the draft runs the live preview script, so it may create cw-preview.
  assert.match(
    res.headers.get('content-security-policy') ?? '',
    /trusted-types loader cw-preview(;|$)/,
  );
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
  assertPreviewHeaders(named.res, 'https://admin.acme.example', 'same-origin');
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
    assert.equal(res.headers.get('referrer-policy'), 'same-origin');
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
  assertPreviewHeaders(normalised.res, 'https://admin.acme.example', 'same-origin');
});

test('with an old unpartitioned grant beside the new one, the draft for the path wins', async () => {
  const cookie = 'cw_preview=p-inline~pw_good; cw_preview=p-about~pw_good';
  const { body } = await call('/__preview/about', { cookie });
  assert.match(body, /About \(draft\)/);
  const inline = await call('/__preview/inline', { cookie });
  assert.match(
    inline.body,
    /data-cw-ref="site\|main\|p-inline\|page\|sections%5Bk-hero%5D\|en-US"/,
  );
});

test('in a frame the preview bar drops its exit link; elsewhere it keeps it', async () => {
  const framed = await call('/__preview/inline', {
    cookie: 'cw_preview=p-inline~pw_good',
    headers: { 'sec-fetch-dest': 'iframe' },
  });
  assert.match(framed.body, /<div class="preview-bar" role="status">Previewing a draft.<\/div>/);
  assert.doesNotMatch(framed.body, /__preview\/exit/);
  const top = await call('/__preview/inline', { cookie: 'cw_preview=p-inline~pw_good' });
  assert.match(top.body, /__preview\/exit/);
});

test('a preview page not showing the draft may not create the cw-preview policy', async () => {
  const { res } = await call('/__preview/', { cookie: 'cw_preview=p-inline~pw_good' });
  assert.match(res.headers.get('content-security-policy') ?? '', /trusted-types loader(;|$)/);
});

test('a preview request that fails keeps the preview policy', async () => {
  const { res } = await call('/__preview/about', {
    cookie: 'cw_preview=p-about~pw_good',
    env: { CONTENTWORKER_DELIVERY: { fetch: async () => new Response('boom', { status: 500 }) } },
  });
  assert.ok(res.status >= 500);
  assert.match(res.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(res.headers.get('x-robots-tag'), 'noindex');
});
