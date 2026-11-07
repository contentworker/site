/**
 * Shapes the starter reads from the ContentWorker Delivery API (single-locale, links embedded),
 * and the contracts between the Worker's pieces. Field values are content-model specific: until
 * `contentworker types` generates per-type interfaces (milestone 7), `Fields` is the one
 * deliberate `any` in the codebase.
 */
import type { Safe } from './html.ts';

// biome-ignore lint/suspicious/noExplicitAny: field shapes come from the space's content model.
export type Fields = Record<string, any>;

/** A link Delivery couldn't embed (unpublished, past `include`, or a cycle). */
export interface LinkStub {
  id: string;
  linkType: 'Entry' | 'Asset';
}

export interface Entry<F extends Fields = Fields> {
  id: string;
  contentType: string;
  publishedAt?: string;
  fields: F;
  metadata?: { tags?: string[]; concepts?: string[] };
}

/** A delivered asset. A type alias (not an interface) so it fits rich-text link targets. */
export type Asset = {
  id: string;
  kind?: string;
  url: string;
  title?: string | null;
  description?: string | null;
  altText?: string | null;
  width?: number | null;
  height?: number | null;
  contentType?: string;
  renditions?: Record<string, string>;
  srcset?: { width: number; url: string }[];
  placeholder?: { thumbhash: string; dominantColor: string } | null;
  video?: {
    status?: string;
    hlsUrl?: string;
    dashUrl?: string;
    thumbnailUrl?: string;
    durationSeconds?: number;
  };
  rights?: { credit?: string; license?: string };
};

/** Rich text is the SDK's shape: one definition shared with every ContentWorker frontend. */
export type { RichTextDocument, RichTextNode } from '@contentworker/sdk/rich-text';

import type { RichTextDocument } from '@contentworker/sdk/rich-text';

export interface ImageOptions {
  sizes?: string;
  rendition?: string;
  className?: string;
}

/** What every block renderer receives (src/render/block-ctx.ts builds it). */
/** A navigation menu item as Delivery serves it: resolved for one locale, dead links dropped. */
export interface MenuItem {
  id: string;
  label: string;
  url?: string | null;
  target?: string;
  attrs?: Record<string, string>;
  entry?: { id: string; contentType: string };
  children?: MenuItem[];
}

/** A navigation menu by handle. */
export interface Menu {
  handle?: string;
  name?: string;
  items: MenuItem[];
}

/** The menus the runtime reads: `main` for the header, `footer` for the footer. */
export interface Menus {
  main?: Menu | null;
  footer?: Menu | null;
}

export interface RenderCtx {
  path: string;
  origin: string;
  year: number;
  headingLevel: number;
  inFirstSection: boolean;
  lcpTaken: boolean;
  fragmentDepth: number;
  /** The site's menus; a custom header or footer reads them here. */
  menus: Menus;
  usedBlocks: Set<BlockModule>;
  raw: (markup: string) => Safe;
  safeHref: (uri: unknown) => string | null;
  pathFor: (entry: Partial<Entry> | null | undefined) => string | null;
  href: (link: unknown) => string | null;
  image: (asset: Asset | null | undefined, opts?: ImageOptions) => Safe;
  richText: (doc: RichTextDocument | null | undefined) => Safe;
  renderBlock: (entry: Entry, opts?: { inline?: boolean }) => Safe;
}

/** What Markdown rendering receives. */
export interface MarkdownCtx {
  origin: string;
  markdownFor?: (entry: Entry, ctx: MarkdownCtx) => string | null;
}

/** A block's server module: public/blocks/<name>/<name>.render.ts. */
export interface BlockModule {
  name: string;
  contentType: string | null;
  css: boolean;
  js: boolean;
  default: (entry: Entry, ctx: RenderCtx) => Safe;
  markdown?: (entry: Entry, ctx: MarkdownCtx) => string;
  structuredData?: (entry: Entry) => Record<string, unknown>[];
  /** True when the block renders the page's h1 itself (the hero); otherwise the document does. */
  ownsTitle?: boolean;
}

/** Header and footer: rendered from siteSettings, which a fresh space may not have yet. */
export interface ChromeModule {
  name: string;
  css: boolean;
  js: boolean;
  default: (settings: Entry | null, ctx: RenderCtx) => Safe;
}

/** What the runtime reads from a site's environment (wrangler.jsonc vars, bindings, secrets). */
export interface SiteEnv {
  /** "<space>/<env>" with a CONTENTWORKER_DELIVERY binding, or "https://<delivery host>/<space>/<env>". */
  CONTENTWORKER: string;
  CONTENTWORKER_LOCALE?: string;
  /** The canonical origin (https://example.com); defaults to the request's. */
  SITE_ORIGIN?: string;
  /** Set by CI to the commit SHA, so each deploy gets fresh code URLs. */
  BUILD_ID: string;
  /** The site's own static assets, if it has a public/ directory. */
  ASSETS?: Fetcher;
  CONTENTWORKER_KEY?: string;
  CONTENTWORKER_WEBHOOK_SECRET?: string;
  CONTENTWORKER_PREVIEW?: string;
  /** The ContentWorker admin's origin, allowed to frame /__preview for live preview. */
  CONTENTWORKER_ADMIN?: string;
  CONTENTWORKER_DELIVERY?: { fetch: typeof fetch };
}

/** An embedded entry (Delivery returned its fields), not a stub. */
export function isEntry(value: unknown): value is Entry {
  return (
    typeof value === 'object' &&
    value !== null &&
    'fields' in value &&
    typeof (value as Entry).fields === 'object'
  );
}

/** An embedded asset (it has a URL), not a stub. */
export function isAsset(value: unknown): value is Asset {
  return typeof value === 'object' && value !== null && typeof (value as Asset).url === 'string';
}

/**
 * A page section as an entry. Sections are either linked block entries, or elements of a
 * ContentWorker blocks field (an Array of Component with variants), stored inline as
 * `{ "_type": "hero", "_key": "…", ...fields }`. Both render through the same block, keyed by
 * content type = variant apiId.
 */
export function asSection(value: unknown): Entry | null {
  if (isEntry(value)) return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { _type, _key, ...fields } = value as Record<string, unknown>;
  if (typeof _type !== 'string') return null;
  const section: Entry = { id: typeof _key === 'string' ? _key : '', contentType: _type, fields };
  if (typeof _key === 'string' && _key) KEYS.set(section, _key);
  return section;
}

/**
 * Blocks-field elements by their `_key`, kept beside the section rather than on it so nothing a
 * public render hashes or prints changes. Only preview renders read it (`data-cw-block`).
 */
const KEYS = new WeakMap<Entry, string>();

/** The `_key` of a section that came from a blocks field, or undefined for a linked entry. */
export function blockKey(section: Entry): string | undefined {
  return KEYS.get(section);
}

/** Whether a field value is a blocks field (inline elements, or empty), not a list of links. */
export function isBlocksField(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every((v) => v && typeof v === 'object' && !isEntry(v) && !('linkType' in v))
  );
}

/** Every section of a field value (a list of links or blocks elements), normalised. */
export function sectionsIn(value: unknown): Entry[] {
  return Array.isArray(value) ? value.map(asSection).filter((s): s is Entry => s !== null) : [];
}

/** What a page rendered under /__preview knows beyond a public render. */
export interface PreviewState {
  /** The draft shown at its own path, or null (published content everywhere else). */
  entry: Entry | null;
  path: string;
  /**
   * The draft's space, environment and locale, for the editing marks (`data-cw-block`,
   * `data-cw-slot`, `data-cw-ref`). Absent, a preview renders without them.
   */
  scope?: { space: string; environment: string; locale: string } | undefined;
  /** Set when the admin frames the page for a live preview session: the origin it listens to. */
  live?: { admin: string } | null | undefined;
  /**
   * The live preview session (`cw_session`) the admin framed the page with, draft shown or not:
   * links to the site's pages carry it and stay under /__preview (src/preview-links.ts).
   */
  session?: string | null | undefined;
}
