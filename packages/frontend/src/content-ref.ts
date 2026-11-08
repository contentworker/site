/**
 * Content refs: the identity of one editable value on a rendered page, stamped as `data-cw-ref`
 * on preview renders so the admin can map a click back to the field or block it came from.
 *
 * The same format as `@contentworker/sdk`'s content refs (docs/specs/live-preview-channel.md,
 * "Content refs inside blocks"): six parts (space, environment, entry id, content type, field
 * path, locale), each URI-encoded and joined with `|`, so a part containing `|` can't forge a
 * boundary. The field part is a path: `title`, `sections[<key>]` for a block, and
 * `sections[<key>].heading` for a field in it, with a key's `[`, `]` and `%` escaped. Kept here
 * rather than imported so the Worker doesn't pull the SDK's client into its bundle; the tests hold
 * it to the SDK's examples.
 */

export interface ContentRef {
  readonly space: string;
  readonly environment: string;
  readonly entryId: string;
  readonly contentType: string;
  /** The field's path: `title`, or `sections[<key>]` and `sections[<key>].heading` in blocks. */
  readonly field: string;
  readonly locale: string;
}

/** One step of a field path below its top-level field: into a block by key, or a field by name. */
export type FieldPathStep = { readonly key: string } | { readonly field: string };

/** A field path, parsed: the entry's top-level field, then each step down. */
export interface FieldPath {
  readonly field: string;
  readonly steps: readonly FieldPathStep[];
}

const NAME = /^[^.[\]]+$/;

/** A key as a path holds it: `%` first, so an escape can't be forged, then `[` and `]`. */
const escapeKey = (key: string): string =>
  key.replace(/%/g, '%25').replace(/\[/g, '%5B').replace(/\]/g, '%5D');
const unescapeKey = (key: string): string =>
  key.replace(/%5B/gi, '[').replace(/%5D/gi, ']').replace(/%25/g, '%');

/**
 * `body`, `body[k1]`, `body[k1].heading`, `body[k1].items[k2].label`. Throws on an empty key, or
 * a field name holding `.`, `[` or `]` (an apiId never does).
 */
export function formatFieldPath(path: FieldPath): string {
  if (!NAME.test(path.field)) throw new Error(`Not a field name: ${path.field}`);
  let out = path.field;
  for (const step of path.steps) {
    if ('key' in step) {
      if (step.key === '') throw new Error('A block key is never empty');
      out += `[${escapeKey(step.key)}]`;
    } else {
      if (!NAME.test(step.field)) throw new Error(`Not a field name: ${step.field}`);
      out += `.${step.field}`;
    }
  }
  return out;
}

/** Parses a ref's field part; undefined when it isn't a path. A plain apiId has no steps. */
export function parseFieldPath(value: string): FieldPath | undefined {
  const head = /^[^.[\]]+/.exec(value);
  if (!head) return undefined;
  const steps: FieldPathStep[] = [];
  let rest = value.slice(head[0].length);
  let last: 'field' | 'key' = 'field';
  while (rest !== '') {
    const block = /^\[([^[\]]+)\]/.exec(rest);
    const field = /^\.([^.[\]]+)/.exec(rest);
    if (block && last === 'field') {
      steps.push({ key: unescapeKey(block[1] as string) });
      last = 'key';
      rest = rest.slice(block[0].length);
    } else if (field && last === 'key') {
      steps.push({ field: field[1] as string });
      last = 'field';
      rest = rest.slice(field[0].length);
    } else {
      return undefined;
    }
  }
  return { field: head[0], steps };
}

/** The top-level field a path is in: everything before the first `[`. */
export function topLevelField(path: string): string {
  const bracket = path.indexOf('[');
  return bracket < 0 ? path : path.slice(0, bracket);
}

/** The `_key` of the block a path names, when it names a block itself (`body[k1]`). */
export function blockKeyOf(path: string): string | undefined {
  const parsed = parseFieldPath(path);
  const last = parsed?.steps.at(-1);
  return last && 'key' in last ? last.key : undefined;
}

export const CONTENT_REF_ATTRIBUTE = 'data-cw-ref';
const SEPARATOR = '|';

export function formatContentRef(ref: ContentRef): string {
  return [ref.space, ref.environment, ref.entryId, ref.contentType, ref.field, ref.locale]
    .map(encodeURIComponent)
    .join(SEPARATOR);
}

/** Parses a serialized ref, or returns undefined if it is not one. */
export function parseContentRef(value: string | null | undefined): ContentRef | undefined {
  if (!value) return undefined;
  let parts: string[];
  try {
    parts = value.split(SEPARATOR).map(decodeURIComponent);
  } catch {
    return undefined;
  }
  if (parts.length !== 6 || parts.some((p) => p === '')) return undefined;
  const [space, environment, entryId, contentType, field, locale] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  return { space, environment, entryId, contentType, field, locale };
}
