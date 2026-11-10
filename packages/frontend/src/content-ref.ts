/**
 * Content refs: the identity of one editable value on a rendered page, stamped as `data-cw-ref`
 * on preview renders so the admin can map a click back to the field or block it came from.
 *
 * `@contentworker/sdk`'s own helpers (docs/specs/live-preview-channel.md, "Content refs inside
 * blocks"): six URI-encoded parts joined by `|` (space, environment, entry id, content type,
 * field path, locale). The field part is a path: `title`, `sections[<key>]` for a block, and
 * `sections[<key>].heading` for a field in it, with a key's `[`, `]` and `%` escaped. Imported
 * by name so the Worker bundles only these (the SDK's client stays out).
 */
export {
  blockKeyOf,
  type ContentRef,
  type FieldPath,
  type FieldPathStep,
  formatContentRef,
  formatFieldPath,
  parseContentRef,
  parseFieldPath,
  topLevelField,
} from '@contentworker/sdk';
