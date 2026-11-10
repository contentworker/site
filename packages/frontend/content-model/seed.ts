/**
 * Creates the runtime's content model and the starter content in a ContentWorker space, over the
 * Management API. Content types are created and published when missing (existing ones are left
 * alone); content goes only into a space with no entries of these types, unless `force`. Entries
 * are created in dependency order so every link points at something that exists, then published.
 */

import type { ContentTypeDef } from './model.ts';
import type { SeedContent, SeedEntry } from './starter-content.ts';

export interface SeedOptions {
  /** Management API origin, e.g. https://api.contentworker.app */
  api: string;
  space: string;
  environment: string;
  /** A Content Management API key (CMA) for the space. */
  token: string;
  locale: string;
  model: ContentTypeDef[];
  content: SeedContent;
  /** Bytes for an asset of this size (the seed generates placeholders). */
  image: (width: number, height: number, seed: number) => Uint8Array<ArrayBuffer>;
  /** Also register the purge webhook: https://<site>/__cw/webhook and its secret. */
  webhook?: { url: string; secret: string; topics: readonly string[] };
  dryRun?: boolean;
  force?: boolean;
  fetch?: typeof fetch;
  log?: (line: string) => void;
}

export interface SeedReport {
  createdTypes: string[];
  skippedTypes: string[];
  assets: Record<string, string>;
  entries: Record<string, string>;
  webhook?: string;
  skippedContent?: string;
}

type Link = { id: string; linkType: 'Entry' | 'Asset' };

/** Keys an entry links to with `{ $entry }`, anywhere in its fields. */
function dependencies(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const v of value) dependencies(v, out);
  else if (value && typeof value === 'object') {
    const ref = (value as { $entry?: unknown }).$entry;
    if (typeof ref === 'string') out.add(ref);
    else for (const v of Object.values(value)) dependencies(v, out);
  }
  return out;
}

/** Entries ordered so each comes after everything it links to. Throws on a cycle. */
export function orderEntries(entries: SeedEntry[]): SeedEntry[] {
  const byKey = new Map(entries.map((e) => [e.key, e]));
  const done = new Set<string>();
  const visiting = new Set<string>();
  const out: SeedEntry[] = [];
  const visit = (e: SeedEntry) => {
    if (done.has(e.key)) return;
    if (visiting.has(e.key)) throw new Error(`Seed entries link in a cycle through "${e.key}"`);
    visiting.add(e.key);
    for (const dep of dependencies(e.fields)) {
      const target = byKey.get(dep);
      if (!target) throw new Error(`"${e.key}" links to unknown entry "${dep}"`);
      visit(target);
    }
    visiting.delete(e.key);
    done.add(e.key);
    out.push(e);
  };
  for (const e of entries) visit(e);
  return out;
}

/** Replaces `{ $entry }` / `{ $asset }` with ContentWorker links. */
export function resolveLinks(
  value: unknown,
  ids: { entries: Record<string, string>; assets: Record<string, string> },
): unknown {
  if (Array.isArray(value)) return value.map((v) => resolveLinks(v, ids));
  if (!value || typeof value !== 'object') return value;
  const v = value as Record<string, unknown>;
  if (typeof v.$entry === 'string') {
    const id = ids.entries[v.$entry];
    if (!id) throw new Error(`No id yet for entry "${v.$entry}"`);
    return { id, linkType: 'Entry' } satisfies Link;
  }
  if (typeof v.$asset === 'string') {
    const id = ids.assets[v.$asset];
    if (!id) throw new Error(`No id for asset "${v.$asset}"`);
    return { id, linkType: 'Asset' } satisfies Link;
  }
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolveLinks(x, ids)]));
}

export async function seed(o: SeedOptions): Promise<SeedReport> {
  const doFetch = o.fetch ?? fetch;
  const log = o.log ?? (() => {});
  const base = `${o.api.replace(/\/$/, '')}/spaces/${encodeURIComponent(o.space)}/environments/${encodeURIComponent(o.environment)}`;
  const headers = {
    authorization: `Bearer ${o.token}`,
    'content-type': 'application/json',
    accept: 'application/json',
  };

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await doFetch(`${base}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!res.ok)
      throw new Error(
        `${method} ${path} → ${res.status} ${await res.text().catch(() => '')}`.trim(),
      );
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  const report: SeedReport = { createdTypes: [], skippedTypes: [], assets: {}, entries: {} };

  // 1. Content types.
  const existing = new Set(
    (await call<{ items: { apiId: string }[] }>('GET', '/content-types')).items.map((t) => t.apiId),
  );
  for (const t of o.model) {
    if (existing.has(t.apiId)) {
      report.skippedTypes.push(t.apiId);
      log(`content type ${t.apiId}: exists, left as is`);
      continue;
    }
    log(`content type ${t.apiId}: ${o.dryRun ? 'would create' : 'creating'} and publish`);
    if (!o.dryRun) {
      await call('POST', '/content-types', t);
      await call('POST', `/content-types/${encodeURIComponent(t.apiId)}/published`);
    }
    report.createdTypes.push(t.apiId);
  }

  // 2. Only an empty space gets content (a re-run must not duplicate a live site's pages).
  if (existing.size > 0 && !o.force) {
    const counts = await call<{ items: { contentType: string; total: number }[] }>(
      'GET',
      '/content-types/entry-counts',
    );
    const used = counts.items.filter(
      (c) => o.model.some((t) => t.apiId === c.contentType) && c.total > 0,
    );
    if (used.length) {
      report.skippedContent = `the space already has ${used.map((c) => `${c.total} ${c.contentType}`).join(', ')} (use --force to add the starter content anyway)`;
      log(`content: skipped, ${report.skippedContent}`);
      return report;
    }
  }

  const ordered = orderEntries(o.content.entries);
  if (o.dryRun) {
    for (const a of o.content.assets)
      log(`asset ${a.key}: would upload ${a.fileName} (${a.width}×${a.height}) and publish`);
    for (const e of ordered) log(`entry ${e.key} (${e.contentType}): would create and publish`);
    if (o.webhook) log(`webhook: would register ${o.webhook.url}`);
    return report;
  }

  // 3. Assets: create (a draft and a signed upload), PUT the bytes, set alt text, publish.
  for (const [i, a] of o.content.assets.entries()) {
    const created = await call<{
      asset: { id: string };
      upload: { url: string; headers: Record<string, string> };
    }>('POST', '/assets', {
      fileName: a.fileName,
      contentType: 'image/png',
      title: { [o.locale]: a.title },
    });
    // The signed upload URL may be relative to the API (a local stack answers one).
    const put = await doFetch(new URL(created.upload.url, o.api).href, {
      method: 'PUT',
      headers: created.upload.headers,
      body: o.image(a.width, a.height, i + 1),
    });
    if (!put.ok) throw new Error(`upload ${a.fileName} → ${put.status}`);
    await call('PATCH', `/assets/${created.asset.id}/metadata`, { altText: { [o.locale]: a.alt } });
    // Ingest measures the file after upload; publishing can briefly wait on it.
    for (let attempt = 0; ; attempt += 1) {
      try {
        await call('POST', `/assets/${created.asset.id}/published`);
        break;
      } catch (error) {
        if (attempt >= 5) throw error;
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
    report.assets[a.key] = created.asset.id;
    log(`asset ${a.key}: ${created.asset.id}`);
  }

  // 4. Entries, each after what it links to; every field value under the default locale.
  for (const e of ordered) {
    const fields = Object.fromEntries(
      Object.entries(e.fields).map(([k, v]) => [k, { [o.locale]: resolveLinks(v, report) }]),
    );
    const view = await call<{ entry: { id: string } }>('POST', '/entries', {
      contentTypeApiId: e.contentType,
      fields,
    });
    await call('POST', `/entries/${view.entry.id}/published`);
    report.entries[e.key] = view.entry.id;
    log(`entry ${e.key} (${e.contentType}): ${view.entry.id}`);
  }

  // 5. The purge webhook, so publishes reach the site's edge cache.
  if (o.webhook) {
    const hook = await call<{ id: string }>('POST', '/webhooks', { ...o.webhook, active: true });
    report.webhook = hook.id;
    log(`webhook: ${hook.id} → ${o.webhook.url}`);
  }
  return report;
}
