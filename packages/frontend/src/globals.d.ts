/**
 * The runtime's entry is the Worker's main module (a site re-exports `Site` and `PurgeQueue`), so
 * `ctx.exports` is typed from it: loopback bindings for Site (RPC included) and PurgeQueue.
 */
// Ambient: included by tsconfig.json, imported by nothing, so builds of the CLI don't pull in the Worker.
export {};

declare global {
  namespace Cloudflare {
    interface GlobalProps {
      mainModule: typeof import('./entry.ts');
      durableNamespaces: 'PurgeQueue';
    }
  }
}
