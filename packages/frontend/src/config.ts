/**
 * The ContentWorker backend, from one setting. `CONTENTWORKER` names the space and environment
 * (the namespace), and how to reach it decides the transport:
 *
 *   HTTP     "CONTENTWORKER": "https://cdn.contentworker.app/<space>/<env>"
 *   binding  "CONTENTWORKER": "<space>/<env>"  plus a service binding CONTENTWORKER_DELIVERY
 *
 * When the binding exists it is used even if the value is a URL (same account, no public hop).
 * Secret CONTENTWORKER_KEY is a Content Delivery API key; CONTENTWORKER_LOCALE defaults to en-US.
 *
 * Preview reads drafts from the Preview API (the CMS's api host, not its delivery host). Over
 * HTTP it is derived: cdn.<domain> → api.<domain>. Set CONTENTWORKER_PREVIEW to its origin to
 * override that, or to enable preview when the backend is a bare namespace over a binding.
 *
 * Live preview frames /__preview pages in the ContentWorker admin, so those pages name the one
 * origin allowed to frame them (CSP frame-ancestors). The admin is the deployment's own domain:
 * cdn.<domain> → https://<domain>, or api.<domain> from CONTENTWORKER_PREVIEW. Set
 * CONTENTWORKER_ADMIN to its origin to override that, or over a binding with no URL to derive
 * from. Without one, preview pages can't be framed at all.
 */

export class ConfigError extends Error {}

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
// Any origin works over a binding: the delivery gateway routes by path only.
const BINDING_ORIGIN = 'https://contentworker.internal';

import type { SiteEnv } from './types.ts';

export interface Backend {
  transport: 'binding' | 'http';
  /** The Delivery base: <origin>/delivery/<space>/<env>. */
  base: string;
  /** The Preview API base for drafts, or null when preview isn't configured. */
  preview: string | null;
  /** The admin's origin, the only one allowed to frame /__preview pages; null when unknown. */
  admin: string | null;
  fetch: typeof fetch;
  space: string;
  environment: string;
  locale: string;
  key: string;
}

const memo = new WeakMap<object, Backend>();

export function backend(env: Partial<SiteEnv>): Backend {
  const cached = memo.get(env);
  if (cached) return cached;
  const value = String(env.CONTENTWORKER ?? '').trim();
  if (!value) {
    throw new ConfigError(
      'Set CONTENTWORKER to "<space>/<env>" (with a CONTENTWORKER_DELIVERY binding) or "https://<delivery host>/<space>/<env>".',
    );
  }
  let origin: string | null = null;
  let namespace = value;
  if (/^https?:\/\//.test(value)) {
    const url = new URL(value);
    origin = url.origin;
    namespace = url.pathname.replace(/^\/(delivery\/)?/, '').replace(/\/$/, '');
  }
  const [space, environment, extra] = namespace.split('/');
  if (
    !space ||
    !environment ||
    extra !== undefined ||
    !SEGMENT.test(space) ||
    !SEGMENT.test(environment)
  ) {
    throw new ConfigError(`CONTENTWORKER namespace must be "<space>/<env>", got "${namespace}".`);
  }
  const binding = env.CONTENTWORKER_DELIVERY;
  if (!binding && !origin) {
    throw new ConfigError(
      'CONTENTWORKER is a bare namespace but there is no CONTENTWORKER_DELIVERY service binding. Add the binding, or use the full https:// URL.',
    );
  }
  if (!env.CONTENTWORKER_KEY) {
    throw new ConfigError(
      'Set the CONTENTWORKER_KEY secret to a Content Delivery API key for this space.',
    );
  }
  let preview: string | null = env.CONTENTWORKER_PREVIEW
    ? new URL(env.CONTENTWORKER_PREVIEW).origin
    : null;
  if (!preview && origin && /^https?:\/\/cdn\./.test(origin))
    preview = origin.replace('//cdn.', '//api.');
  const admin = adminOrigin(env.CONTENTWORKER_ADMIN, origin, preview);
  const key: string = env.CONTENTWORKER_KEY;
  const config: Backend = {
    preview: preview ? `${preview}/preview/${space}/${environment}` : null,
    admin,
    transport: binding ? 'binding' : 'http',
    base: `${binding ? BINDING_ORIGIN : origin}/delivery/${space}/${environment}`,
    fetch: binding ? (u, i) => binding.fetch(u, i) : (u, i) => fetch(u, i),
    space,
    environment,
    locale: env.CONTENTWORKER_LOCALE || 'en-US',
    key,
  };
  memo.set(env, config);
  return config;
}

/**
 * The admin origin: CONTENTWORKER_ADMIN, else the domain behind cdn.<domain> (the Delivery URL)
 * or api.<domain> (the Preview API). Only an exact https origin is accepted (http only on
 * localhost, as the live preview SDK requires); never a wildcard.
 */
function adminOrigin(
  explicit: string | undefined,
  delivery: string | null,
  preview: string | null,
): string | null {
  if (explicit?.trim()) {
    const value = explicit.trim().replace(/\/$/, '');
    const origin = previewOrigin(value);
    if (!origin || origin !== value || value.includes('*'))
      throw new ConfigError(
        `CONTENTWORKER_ADMIN must be an exact https origin like https://admin.example.com (http only on localhost), got "${explicit}".`,
      );
    return origin;
  }
  if (delivery && /^https?:\/\/cdn\./.test(delivery))
    return previewOrigin(delivery.replace('//cdn.', '//'));
  if (preview && /^https?:\/\/api\./.test(preview))
    return previewOrigin(preview.replace('//api.', '//'));
  return null;
}

/** The origin of an https URL (or http on localhost), or null. */
function previewOrigin(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null;
  return url.origin;
}
