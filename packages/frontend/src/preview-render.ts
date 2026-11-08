import type { Backend } from './config.ts';
import { formatFieldPath, parseContentRef, parseFieldPath } from './content-ref.ts';
import { previewHeaders, textHeaders } from './headers.ts';
import { fetchDraft, jsonBody, readCookie } from './preview.ts';
import { stayInPreview } from './preview-links.ts';
import { createRenderCtx } from './render/block-ctx.ts';
import { type MainPart, mainParts, marksFor } from './render/document.ts';
import { pathFor } from './routes.ts';
import type { Entry } from './types.ts';

/**
 * POST /__preview/render: the live preview script's re-render. Takes the entry's unsaved fields
 * (what `connectPreview`'s `onState` hands the page: `view.withProposals`, one locale's values,
 * typed as the Management API types them) and answers the HTML they produce, rendered by the same
 * block renderers and escaping as any page:
 *
 *   { "entryId": "…", "locale"?: "en-US", "fields": { … }, "refs"?: ["<block ref>", …] }
 *
 * `refs` are the `data-cw-ref` values of the blocks to re-render (`sections[<key>]` refs of this
 * entry); the key in each names the block. A field left out keeps the draft's value. A link the
 * draft already embeds (an image, a linked entry) is resolved from the draft; any other stays a
 * stub, which renders as nothing, as on a page.
 *
 * Answers `{ blocks: [{ ref, key, html }], css: [hrefs] }` for `refs`, or `{ main, css }` (all of
 * <main>) without them, and also whenever swapping single blocks could leave the page wrong: a key
 * the fields no longer render (removed, or not there yet), a key on more than one block, or the
 * first section (it decides the page's h1 and every heading level after it). A block that renders
 * to nothing answers `html: ""`. `css` is every block stylesheet the HTML needs. Links to the
 * site's pages stay under /__preview, as on the page.
 *
 * `locale`, when given, must be the site's own (CONTENTWORKER_LOCALE): the page renders one
 * locale, and its refs say which.
 *
 * Only for the grant in this browser's preview cookie, and only for that entry: the token is
 * checked against the Preview API on every call, as a preview page load does. Same-origin POSTs
 * only (the script runs in the framed preview page), JSON only, at most MAX_RENDER_BYTES, never
 * cached and never indexed.
 */
export const MAX_RENDER_BYTES = 2 * 1024 * 1024;
const MAX_REFS = 500;
const MAX_REF_LENGTH = 2048;
const MAX_DEPTH = 64;
const MAX_NODES = 200_000;
/** Names that reach an object's prototype when assigned; dropped from supplied fields. */
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

export interface RenderDeps {
  request: Request;
  url: URL;
  cw: Backend;
  site: { origin: string; codeBase: string };
  /** The origin allowed to frame preview responses (preview.ts frameAncestor). */
  admin: string | null;
}

const json = (admin: string | null, body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...textHeaders(previewHeaders(admin)),
      'content-type': 'application/json; charset=utf-8',
    },
  });

export async function renderPreviewBlocks({
  request,
  url,
  cw,
  site,
  admin,
}: RenderDeps): Promise<Response> {
  const read = await jsonBody(request, url, admin, MAX_RENDER_BYTES);
  if ('refused' in read) return read.refused;
  const { entryId, fields, locale, refs } = read.body;
  if (typeof entryId !== 'string' || !isRecord(fields))
    return json(admin, { error: 'Send entryId and fields.' }, 400);
  if (locale !== undefined && (typeof locale !== 'string' || !locale))
    return json(admin, { error: 'locale must be a locale code.' }, 400);
  if (locale !== undefined && locale !== cw.locale)
    return json(admin, { error: `This site renders ${cw.locale}; send that locale.` }, 422);
  let keys: string[] | null = null;
  if (refs !== undefined) {
    if (!Array.isArray(refs) || refs.length > MAX_REFS)
      return json(admin, { error: `refs must be at most ${MAX_REFS} block refs.` }, 400);
    keys = [];
    for (const r of refs) {
      const key =
        typeof r === 'string' && r.length <= MAX_REF_LENGTH ? blockOf(r, cw, entryId) : null;
      if (key === null)
        return json(admin, { error: "Each ref must name one of this entry's blocks." }, 400);
      keys.push(key);
    }
  }

  const granted = readCookie(request, entryId);
  if (!granted || granted.entryId !== entryId)
    return json(admin, { error: 'No preview grant for this entry.' }, 403);
  const draft = await fetchDraft(cw, granted.entryId, granted.token);
  if (!draft) return json(admin, { error: 'This preview has expired.' }, 403);

  let entry: Entry;
  try {
    entry = overlay(draft, fields);
  } catch (error) {
    if (error instanceof TooLarge) return json(admin, { error: error.message }, 413);
    throw error;
  }
  const path = pathFor(draft) ?? '/';
  const ctx = createRenderCtx({ path, origin: site.origin });
  const marks = marksFor({
    entry,
    path,
    scope: { space: cw.space, environment: cw.environment, locale: cw.locale },
  });
  let parts: MainPart[];
  try {
    parts = [...mainParts({ entry, ctx, codeBase: site.codeBase, linked: new Set(), marks })];
  } catch (error) {
    // A half-edited field a renderer can't take: the page keeps what it shows.
    console.error(JSON.stringify({ msg: 'preview render failed', error: String(error) }));
    return json(admin, { error: 'These fields could not be rendered.' }, 422);
  }

  const origins = [...new Set([site.origin, url.origin])];
  const links = (h: string) => stayInPreview(h, { origins });
  const whole = () =>
    json(admin, {
      main: links(parts.map((p) => p.html).join('')),
      css: [...new Set(parts.flatMap((p) => p.needs))],
    });
  if (!keys) return whole();
  const found: { key: string; part: MainPart }[] = [];
  for (const key of new Set(keys)) {
    const matches = parts.filter((p) => p.key === key);
    const part = matches[0];
    if (!part || matches.length > 1 || part.index === 0) return whole();
    found.push({ key, part });
  }
  return json(admin, {
    blocks: found.map(({ key, part }) => ({
      ref: marks?.(formatFieldPath({ field: 'sections', steps: [{ key }] })),
      key,
      html: links(part.section),
    })),
    css: [...new Set(found.flatMap(({ part }) => part.needs))],
  });
}

/** The `_key` a block ref names, when it is a `sections[<key>]` ref of this entry; else null. */
function blockOf(value: string, cw: Backend, entryId: string): string | null {
  const ref = parseContentRef(value);
  if (
    !ref ||
    ref.space !== cw.space ||
    ref.environment !== cw.environment ||
    ref.entryId !== entryId ||
    ref.locale !== cw.locale
  )
    return null;
  const path = parseFieldPath(ref.field);
  const step = path?.steps[0];
  if (path?.field !== 'sections' || path.steps.length !== 1 || !step || !('key' in step))
    return null;
  return step.key;
}

class TooLarge extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The draft with the supplied fields over it, links resolved from what the draft embeds. Copies
 * every supplied value (nothing the caller sent is rendered by reference), drops prototype names,
 * and refuses values nested deeper than MAX_DEPTH or larger than MAX_NODES.
 */
export function overlay(draft: Entry, fields: Record<string, unknown>): Entry {
  const index = new Map<string, unknown>();
  collect(draft.fields, index);
  let nodes = 0;
  const copy = (value: unknown, depth: number): unknown => {
    nodes += 1;
    if (nodes > MAX_NODES) throw new TooLarge('fields are too large to render');
    if (depth > MAX_DEPTH) throw new TooLarge('fields are nested too deeply to render');
    if (Array.isArray(value)) return value.map((v) => copy(v, depth + 1));
    if (!isRecord(value)) return value;
    if (isStub(value)) return index.get(value.id) ?? { id: value.id, linkType: value.linkType };
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (!FORBIDDEN.has(k)) out[k] = copy(v, depth + 1);
    return out;
  };
  const next: Record<string, unknown> = { ...draft.fields };
  for (const [name, value] of Object.entries(fields))
    if (!FORBIDDEN.has(name)) next[name] = copy(value, 0);
  return { ...draft, fields: next };
}

function isStub(value: Record<string, unknown>): value is { id: string; linkType: string } {
  return (
    typeof value.id === 'string' &&
    (value.linkType === 'Entry' || value.linkType === 'Asset') &&
    !('fields' in value) &&
    !('url' in value)
  );
}

/**
 * Every entry and asset the draft embeds, by id, breadth first: when one appears more than once,
 * the shallowest copy (the one Delivery resolved furthest) wins.
 */
function collect(root: unknown, index: Map<string, unknown>): void {
  let level: unknown[] = [root];
  for (let depth = 0; depth <= 12 && level.length; depth += 1) {
    const next: unknown[] = [];
    for (const value of level) {
      if (Array.isArray(value)) {
        next.push(...value);
        continue;
      }
      if (!isRecord(value)) continue;
      if (
        typeof value.id === 'string' &&
        (isRecord(value.fields) || typeof value.url === 'string') &&
        !index.has(value.id)
      )
        index.set(value.id, value);
      next.push(...Object.values(value));
    }
    level = next;
  }
}
