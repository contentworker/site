/**
 * The starter content as the Delivery API would return it once seeded: single-locale values,
 * links embedded (entries with their fields, assets in the delivered shape). Used to render the
 * real showcase pages in tests and in the Lighthouse gate (scripts/mock-delivery.ts --content starter).
 */
import { starterContent } from '../content-model/starter-content.ts';
import type { Entry } from '../src/types.ts';
import { asset } from './fixtures.ts';

const byKey = new Map(starterContent.entries.map((e) => [e.key, e]));
const assets = new Map(starterContent.assets.map((a) => [a.key, a]));

function embed(value: unknown, depth: number): unknown {
  if (Array.isArray(value)) return value.map((v) => embed(v, depth));
  if (!value || typeof value !== 'object') return value;
  const v = value as Record<string, unknown>;
  if (typeof v.$asset === 'string') {
    const a = assets.get(v.$asset);
    return asset(`asset-${v.$asset}`, {
      width: a?.width ?? 1600,
      height: a?.height ?? 800,
      altText: a?.alt ?? '',
      title: a?.title ?? '',
    });
  }
  if (typeof v.$entry === 'string') {
    const target = byKey.get(v.$entry);
    if (!target) return null;
    return depth > 4
      ? { id: `entry-${target.key}`, linkType: 'Entry' }
      : delivered(target.key, depth + 1);
  }
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, embed(x, depth)]));
}

export function delivered(key: string, depth = 0): Entry {
  const e = byKey.get(key);
  if (!e) throw new Error(`no starter entry ${key}`);
  return {
    id: `entry-${key}`,
    contentType: e.contentType,
    publishedAt: '2026-11-02T00:00:00Z',
    fields: embed(e.fields, depth) as Record<string, unknown>,
  };
}

/** Delivery's answer per content type, for fakeDelivery({ extra }). */
export function starterByType(): Record<string, Entry[]> {
  const out: Record<string, Entry[]> = {};
  for (const e of starterContent.entries) {
    const list = out[e.contentType] ?? [];
    list.push(delivered(e.key));
    out[e.contentType] = list;
  }
  return out;
}
