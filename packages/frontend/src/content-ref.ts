/**
 * Content refs: the identity of one editable value on a rendered page, stamped as `data-cw-ref`
 * on preview renders so the admin can map a click back to the field it came from.
 *
 * The same format as `formatContentRef` in `@contentworker/sdk`: six parts (space, environment,
 * entry id, content type, field apiId, locale), each URI-encoded and joined with `|`. Encoding each
 * part means a part containing `|` can't forge a boundary and shift the parts after it. Kept here
 * rather than imported so the Worker doesn't pull the SDK's client into its bundle; the tests hold
 * it to the SDK's examples.
 */

export interface ContentRef {
  readonly space: string;
  readonly environment: string;
  readonly entryId: string;
  readonly contentType: string;
  /** apiId of the field, e.g. `title`. */
  readonly field: string;
  readonly locale: string;
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
