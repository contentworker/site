import type { Entry } from '../../src/types.ts';
import worker, { Site } from '../../src/worker.ts';
import { about, doc, env, fakeDelivery, inlinePage, p, text, world } from '../fixtures.ts';

/** The drafts the fake Preview API serves for token pw_good. */
export const drafts: Record<string, Entry> = {
  'p-about': {
    ...about,
    fields: { ...about.fields, title: 'About (draft)', body: doc(p(text('Unpublished words.'))) },
  },
  'p-inline': { ...inlinePage, fields: { ...inlinePage.fields, title: 'Inline (draft)' } },
  /** A blocks page whose block keys need escaping in a ref path. */
  'p-odd': {
    id: 'p-odd',
    contentType: 'page',
    fields: {
      title: 'Odd (draft)',
      slug: 'odd',
      sections: [{ _type: 'cta', _key: 'a[b]%', heading: 'Odd key', body: doc(p(text('x'))) }],
    },
  },
  /** A blocks page whose first block is default content: its heading decides the page's h1. */
  'p-rt': {
    id: 'p-rt',
    contentType: 'page',
    fields: {
      title: 'Rich (draft)',
      slug: 'rt',
      sections: [
        { _type: 'richText', _key: 'k-rt', heading: 'Rich heading', body: doc(p(text('Body.'))) },
        { _type: 'cta', _key: 'k-cta', heading: 'Act', body: doc(p(text('Now.'))) },
      ],
    },
  },
};

export const SITE = 'https://contentworker.site';
/** The admin the default backend derives: cdn.example → https://example. */
export const ADMIN = 'https://example';

export interface CallOptions {
  method?: string;
  cookie?: string;
  headers?: Record<string, string>;
  body?: string;
  env?: Record<string, unknown>;
}

/**
 * One request through the gateway, with the Preview API (any host, /preview/…) and Delivery over the
 * fake binding. Records every Preview API call.
 */
export async function call(path: string, options: CallOptions = {}) {
  const { method = 'GET', cookie, headers = {}, body } = options;
  const realFetch = globalThis.fetch;
  const previewCalls: URL[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (!url.pathname.startsWith('/preview/')) return realFetch(input);
    previewCalls.push(url);
    const id = /\/entries\/([^/]+)$/.exec(url.pathname)?.[1] ?? '';
    const draft = drafts[decodeURIComponent(id)];
    const ok = draft && url.searchParams.get('preview_token') === 'pw_good';
    return ok ? Response.json(draft) : new Response('no', { status: 403 });
  };
  try {
    const delivery = fakeDelivery();
    const e = env({
      CONTENTWORKER: 'https://cdn.example/site/main',
      CONTENTWORKER_DELIVERY: delivery,
      ...options.env,
    });
    const w = await world(Site, e);
    const init: RequestInit = {
      method,
      headers: { ...(cookie ? { cookie } : {}), ...headers },
      ...(body !== undefined ? { body } : {}),
    };
    const res = await worker.fetch(new Request(`${SITE}${path}`, init), e, w.ctx);
    const out = res.status === 200 ? await res.text() : '';
    await Promise.all(w.ctx.pending);
    return { res, body: out, previewCalls };
  } finally {
    globalThis.fetch = realFetch;
  }
}

/** A same-origin JSON POST, as the preview page's scripts send it. */
export function post(path: string, json: unknown, options: CallOptions = {}) {
  return call(path, {
    method: 'POST',
    ...options,
    headers: {
      origin: SITE,
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
      ...options.headers,
    },
    body: typeof json === 'string' ? json : JSON.stringify(json),
  });
}

export const GRANT = 'cw_preview=p-inline~pw_good';
