/**
 * A complete site Worker with no site code: point wrangler.jsonc `main` here.
 *   "main": "node_modules/@contentworker/frontend/src/entry.ts"
 */
import { defineSite } from './define.ts';

export default defineSite();
export { PurgeQueue, Site } from './index.ts';
