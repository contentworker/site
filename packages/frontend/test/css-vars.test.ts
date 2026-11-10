import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cssVars } from '../src/css-vars.ts';
import { attrs, html } from '../src/html.ts';
import { blockCtx } from './fixtures.ts';

test('safe token values become custom properties', () => {
  assert.equal(
    cssVars({
      '--accent': 'var(--link-color)',
      '--gap': 'calc(1rem + 2px)',
      '--tone': 'oklch(70% 0.1 250)',
      '--cols': 3,
    }),
    '--accent:var(--link-color);--gap:calc(1rem + 2px);--tone:oklch(70% 0.1 250);--cols:3',
  );
});

test('an unsafe value is dropped whole, and so is a name that is not a custom property', () => {
  const unsafe = [
    'url(https://evil.example/x.png)',
    'URL(x)',
    'u\\rl(x)',
    'image-set("x.png" 1x)',
    'red; background: url(x)',
    'red" onmouseover="alert(1)',
    "red' x='y",
    'ur&#108;(x)',
    '</style><script>',
    'expression(alert(1))',
    'javascript:alert(1)',
    '@import "x"',
    'red /* c */',
    '{}',
    'a\nb',
    '`x`',
    '',
    '   ',
  ];
  for (const value of unsafe) assert.equal(cssVars({ '--x': value }), null, JSON.stringify(value));
  assert.equal(cssVars({ '--ok': 'red', '--bad': 'url(x)' }), '--ok:red');
  for (const name of ['color', '-x', '--', '--a;b', '--a:b', '--1x'])
    assert.equal(cssVars({ [name]: 'red' }), null, name);
  assert.equal(cssVars({ '--n': Number.NaN, '--o': { toString: () => 'red' } }), null);
});

test('block renderers get it on ctx; nothing unsafe reaches the attribute', () => {
  const ctx = blockCtx();
  const out = (accent: unknown) =>
    html`<div${attrs({ style: ctx.cssVars({ '--card-accent': accent }) })}></div>`.value;
  assert.equal(out('var(--link-color)'), '<div style="--card-accent:var(--link-color)"></div>');
  assert.equal(out('red" onclick="x'), '<div></div>');
  assert.equal(out('url(//evil.example)'), '<div></div>');
});
