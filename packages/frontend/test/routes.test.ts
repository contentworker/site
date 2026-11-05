import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cacheableSearch, match, normalize, pathFor } from '../src/routes.ts';

const n = (u: string) => normalize(new URL(u, 'https://contentworker.site'));

test('normalize: canonical paths need no redirect', () => {
  assert.deepEqual(n('/'), { path: '/', redirect: null });
  assert.deepEqual(n('/about'), { path: '/about', redirect: null });
});

test('normalize: case, trailing slash, .html, index and /home redirect', () => {
  assert.equal(n('/About/').redirect, '/about');
  assert.equal(n('/about.html?x=1').redirect, '/about?x=1');
  assert.equal(n('/blog/index.html').redirect, '/blog');
  assert.equal(n('/home').redirect, '/');
});

test('match: home, pages and articles', () => {
  assert.deepEqual(match('/'), {
    name: 'home',
    contentType: 'page',
    slug: 'home',
    slugField: 'slug',
  });
  assert.deepEqual(match('/about'), {
    name: 'entry',
    contentType: 'page',
    slug: 'about',
    slugField: 'slug',
  });
  assert.deepEqual(match('/blog/hello-world'), {
    name: 'entry',
    contentType: 'article',
    slug: 'hello-world',
    slugField: 'slug',
  });
  assert.deepEqual(match('/blog/page/2'), {
    name: 'list',
    list: 'article',
    page: 2,
    base: '/blog',
    title: 'Blog',
    description: 'Articles, newest first.',
  });
  assert.equal(match('/a/b/c'), null);
  assert.equal(match('/bad_slug'), null);
});

test('pathFor mirrors the routes', () => {
  assert.equal(pathFor({ contentType: 'page', fields: { slug: 'home' } }), '/');
  assert.equal(pathFor({ contentType: 'page', fields: { slug: 'about' } }), '/about');
  assert.equal(pathFor({ contentType: 'article', fields: { slug: 'x' } }), '/blog/x');
  assert.equal(pathFor({ contentType: 'person', fields: { slug: 'x' } }), null);
});

test('cacheableSearch strips tracking params and sorts the rest', () => {
  const u = new URL('https://x/a?utm_source=a&b=2&gclid=z&a=1');
  assert.equal(cacheableSearch(u), '?a=1&b=2');
  assert.equal(cacheableSearch(new URL('https://x/a?utm_medium=x')), '');
});

test('site routes: new types, listings, and replacing a default', async () => {
  const { setRoutes, routedTypes } = await import('../src/routes.ts');
  try {
    setRoutes([
      { path: '/products/:slug', contentType: 'product' },
      { path: '/products', list: 'product', title: 'Products' },
      { path: '/news/:slug', contentType: 'article' },
    ]);
    assert.deepEqual(match('/products/red-chair'), {
      name: 'entry',
      contentType: 'product',
      slug: 'red-chair',
      slugField: 'slug',
    });
    assert.equal(match('/products/page/3')?.name, 'list');
    assert.equal(
      pathFor({ contentType: 'product', fields: { slug: 'red-chair' } }),
      '/products/red-chair',
    );
    // Articles moved to /news; /blog/:slug is gone, the /blog listing stays.
    assert.equal(pathFor({ contentType: 'article', fields: { slug: 'x' } }), '/news/x');
    assert.equal(match('/blog/x'), null);
    assert.equal(match('/blog')?.name, 'list');
    assert.deepEqual(routedTypes(), ['page', 'product', 'article']);
    assert.throws(() => setRoutes([{ path: '/Bad/:slug', contentType: 'x' }]), /lowercase/);
    assert.throws(() => setRoutes([{ path: '/x', contentType: 'x' }]), /:slug/);
  } finally {
    setRoutes([]);
  }
  assert.deepEqual(routedTypes(), ['page', 'article']);
});

test('CMS URL patterns become routes: any Slug field, site routes win, {id}/{locale} skipped', async () => {
  const { routesFromPatterns, setCmsRoutes, setRoutes } = await import('../src/routes.ts');
  try {
    const cms = routesFromPatterns([
      { contentType: 'page', urlPattern: '/{slug}' },
      { contentType: 'product', urlPattern: '/shop/{handle}' },
      { contentType: 'doc', urlPattern: '/{locale}/docs/{slug}' },
      { contentType: 'thing', urlPattern: '/things/{id}' },
      { contentType: 'loud', urlPattern: '/Loud/{slug}' },
    ]);
    assert.deepEqual(cms, [
      { path: '/:slug', contentType: 'page', slugField: 'slug' },
      { path: '/shop/:slug', contentType: 'product', slugField: 'handle' },
    ]);
    setCmsRoutes(cms);
    assert.deepEqual(match('/shop/red-chair'), {
      name: 'entry',
      contentType: 'product',
      slug: 'red-chair',
      slugField: 'handle',
    });
    assert.equal(
      pathFor({ contentType: 'product', fields: { handle: 'red-chair' } }),
      '/shop/red-chair',
    );
    // A prefixed route stays ahead of the catch-all page route, whatever layer it came from.
    assert.equal(match('/shop/x')?.name, 'entry');
    assert.equal(match('/blog/x')?.name, 'entry');
    // The site's own route beats the CMS's.
    setRoutes([{ path: '/store/:slug', contentType: 'product', slugField: 'handle' }]);
    assert.equal(
      pathFor({ contentType: 'product', fields: { handle: 'red-chair' } }),
      '/store/red-chair',
    );
  } finally {
    setRoutes([]);
    setCmsRoutes([]);
  }
});
