#!/usr/bin/env node
/**
 * contentworker-site: the runtime's command line, for sites.
 *
 *   npx contentworker-site new-block <name> [--js]     add a block to this site
 *   npx contentworker-site seed [--dry-run] [--force]  create the content model and starter content
 *
 * Published as compiled JavaScript (dist/scripts/cli.js): Node won't strip types inside
 * node_modules. In this repo it runs from source.
 */
const [command = 'help', ...rest] = process.argv.slice(2);
const commands: Record<string, () => Promise<unknown>> = {
  'new-block': () => import('./site-new-block.ts'),
  seed: () => import('./seed.ts'),
};
const run = commands[command];
if (run) {
  // Each command reads its own arguments from process.argv, as when run directly.
  process.argv = [process.argv[0] ?? 'node', command, ...rest];
  await run();
} else {
  console.log(`Usage: contentworker-site <command>

  new-block <name> [--js]                  add a block to this site
  seed [--dry-run] [--force] [--webhook <url> --webhook-secret <secret>]
                                           create the content model and starter content`);
  process.exitCode = command === 'help' || command === '--help' ? 0 : 1;
}
