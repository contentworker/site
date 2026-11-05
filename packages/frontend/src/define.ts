import { registerBlocks, setChrome } from './render/blocks.ts';
import { type RouteDef, setRoutes } from './routes.ts';
import type { BlockModule, ChromeModule } from './types.ts';
import { gateway } from './worker.ts';

export interface SiteOptions {
  /** Extra blocks, or replacements for the runtime's (matched by content type). */
  blocks?: readonly BlockModule[];
  /**
   * Extra URLs: `{ path: '/products/:slug', contentType: 'product' }` renders entries,
   * `{ path: '/products', list: 'product', title: 'Products' }` a paged listing. A route for an
   * existing content type or path replaces the default (e.g. articles at `/news/:slug`).
   */
  routes?: readonly RouteDef[];
  /** A custom header or footer. */
  header?: ChromeModule;
  footer?: ChromeModule;
}

/**
 * The site's Worker. Everything is the runtime's unless the site passes its own blocks, header or
 * footer. Export the result as the default, alongside `Site` and `PurgeQueue`:
 *
 *   import { defineSite } from '@contentworker/frontend';
 *   import * as testimonial from './blocks/testimonial.render.ts';
 *   export default defineSite({ blocks: [testimonial] });
 *   export { Site, PurgeQueue } from '@contentworker/frontend';
 *
 * A site with no custom code skips this file entirely: point wrangler.jsonc `main` at
 * `node_modules/@contentworker/frontend/src/entry.ts`.
 */
export function defineSite(options: SiteOptions = {}): ExportedHandler<never> {
  if (options.blocks) registerBlocks(options.blocks);
  if (options.routes) setRoutes(options.routes);
  const chrome: Parameters<typeof setChrome>[0] = {};
  if (options.header) chrome.header = options.header;
  if (options.footer) chrome.footer = options.footer;
  setChrome(chrome);
  return gateway as ExportedHandler<never>;
}
