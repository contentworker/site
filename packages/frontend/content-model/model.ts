/**
 * The content model the runtime renders, as ContentWorker content types. `npm run seed` creates
 * it in a space; `test/content-model.test.ts` checks it against the block registry, so a block and
 * its variant can't drift apart.
 *
 * Pages are built from a **blocks field** (`sections`: an Array of Component with variants), so an
 * editor composes a page in one entry and picks blocks from an "Add block" menu. Each variant's
 * apiId is a block's content type. Linked block entries (the older shape) still render too.
 *
 * `urlPattern` matches the runtime's default routes, so ContentWorker writes a redirect from the
 * old path whenever a published slug changes, and its preview opens the right page.
 */

type FieldType =
  | 'Symbol'
  | 'Slug'
  | 'Text'
  | 'RichText'
  | 'Integer'
  | 'Number'
  | 'Boolean'
  | 'Date'
  | 'JSON'
  | 'Link'
  | 'Component'
  | 'Array';

export interface FieldDef {
  apiId: string;
  name: string;
  type: FieldType;
  localized: boolean;
  required: boolean;
  position: number;
  unique?: boolean;
  linkType?: 'Entry' | 'Asset';
  validations?: Record<string, unknown>;
  fields?: FieldDef[];
  items?: {
    type: 'Symbol' | 'Link' | 'Component';
    linkType?: 'Entry' | 'Asset';
    validations?: Record<string, unknown>;
    fields?: FieldDef[];
    variants?: { apiId: string; name: string; fields: FieldDef[] }[];
  };
}

export interface ContentTypeDef {
  apiId: string;
  name: string;
  displayField: string;
  urlPattern?: string;
  fields: FieldDef[];
}

type Spec = Omit<FieldDef, 'position' | 'localized' | 'required'> & {
  localized?: boolean;
  required?: boolean;
};

/** Fields in order, with positions, and the defaults: not required; text localized at top level. */
function fields(specs: Spec[], nested = false): FieldDef[] {
  return specs.map((s, position) => ({
    // Text fields at the top level are localized by default; nested and Slug fields never are.
    localized: !nested && ['Symbol', 'Text', 'RichText'].includes(s.type),
    required: false,
    ...s,
    ...(nested ? { localized: false } : {}),
    position,
    ...(s.fields ? { fields: fields(s.fields as Spec[], true) } : {}),
    ...(s.items?.fields
      ? { items: { ...s.items, fields: fields(s.items.fields as Spec[], true) } }
      : {}),
    ...(s.items?.variants
      ? {
          items: {
            ...s.items,
            variants: s.items.variants.map((v) => ({
              ...v,
              fields: fields(v.fields as Spec[], true),
            })),
          },
        }
      : {}),
  }));
}

const asset = (apiId: string, name: string): Spec => ({
  apiId,
  name,
  type: 'Link',
  linkType: 'Asset',
});
const entryLink = (apiId: string, name: string, types: string[]): Spec => ({
  apiId,
  name,
  type: 'Link',
  linkType: 'Entry',
  validations: { linkContentTypes: types },
});

const seo: Spec = {
  apiId: 'seo',
  name: 'SEO',
  type: 'Component',
  fields: [
    {
      apiId: 'title',
      name: 'Title (search results)',
      type: 'Symbol',
      validations: { size: { max: 70 } },
    },
    {
      apiId: 'description',
      name: 'Description',
      type: 'Text',
      validations: { size: { max: 160 } },
    },
    asset('image', 'Share image'),
    { apiId: 'noindex', name: 'Hide from search engines', type: 'Boolean' },
  ] as unknown as FieldDef[],
};

const card: Spec[] = [
  { apiId: 'title', name: 'Title', type: 'Symbol' },
  { apiId: 'body', name: 'Text', type: 'RichText' },
  asset('image', 'Image'),
  entryLink('link', 'Links to', ['page', 'article']),
  { apiId: 'url', name: 'Or URL', type: 'Symbol' },
];

/** The blocks an editor can add to a page or fragment: apiId = the block's content type. */
export const VARIANTS = [
  {
    apiId: 'hero',
    name: 'Hero',
    fields: [
      { apiId: 'heading', name: 'Heading', type: 'Symbol', required: true },
      { apiId: 'lead', name: 'Lead', type: 'RichText' },
      asset('image', 'Background image'),
    ],
  },
  {
    apiId: 'richText',
    name: 'Text',
    fields: [{ apiId: 'body', name: 'Text', type: 'RichText', required: true }],
  },
  {
    apiId: 'cards',
    name: 'Cards',
    fields: [
      { apiId: 'heading', name: 'Heading', type: 'Symbol' },
      {
        apiId: 'items',
        name: 'Cards',
        type: 'Array',
        items: { type: 'Component', fields: card as unknown as FieldDef[] },
      },
    ],
  },
  {
    apiId: 'columns',
    name: 'Columns',
    fields: [
      {
        apiId: 'columns',
        name: 'Columns',
        type: 'Array',
        validations: { size: { min: 2, max: 4 } },
        items: {
          type: 'Component',
          fields: [
            { apiId: 'body', name: 'Text', type: 'RichText' },
            asset('image', 'Image'),
          ] as unknown as FieldDef[],
        },
      },
    ],
  },
  {
    apiId: 'faq',
    name: 'FAQ',
    fields: [
      { apiId: 'heading', name: 'Heading', type: 'Symbol' },
      {
        apiId: 'items',
        name: 'Questions',
        type: 'Array',
        items: {
          type: 'Component',
          fields: [
            { apiId: 'question', name: 'Question', type: 'Symbol', required: true },
            { apiId: 'answer', name: 'Answer', type: 'RichText', required: true },
          ] as unknown as FieldDef[],
        },
      },
    ],
  },
  {
    apiId: 'cta',
    name: 'Call to action',
    fields: [
      { apiId: 'heading', name: 'Heading', type: 'Symbol' },
      { apiId: 'body', name: 'Text', type: 'RichText' },
      { apiId: 'label', name: 'Button label', type: 'Symbol' },
      entryLink('link', 'Button links to', ['page', 'article']),
      { apiId: 'url', name: 'Or URL', type: 'Symbol' },
      {
        apiId: 'variant',
        name: 'Style',
        type: 'Symbol',
        validations: { in: ['primary', 'secondary', 'accent'] },
      },
    ],
  },
  {
    apiId: 'media',
    name: 'Image or video',
    fields: [
      asset('asset', 'Image or video'),
      { apiId: 'caption', name: 'Caption', type: 'Symbol' },
      { apiId: 'wide', name: 'Full width', type: 'Boolean' },
    ],
  },
  {
    apiId: 'fragment',
    name: 'Shared section',
    fields: [entryLink('fragment', 'Shared section', ['fragment'])],
  },
] as unknown as NonNullable<FieldDef['items']>['variants'];

const sections = (variants = VARIANTS): Spec => ({
  apiId: 'sections',
  name: 'Sections',
  type: 'Array',
  items: { type: 'Component', variants },
});

export const CONTENT_TYPES: ContentTypeDef[] = [
  {
    apiId: 'siteSettings',
    name: 'Site settings',
    displayField: 'name',
    fields: fields([
      { apiId: 'name', name: 'Site name', type: 'Symbol', required: true },
      { apiId: 'description', name: 'Description', type: 'Text' },
      { apiId: 'llmsSummary', name: 'Summary for AI (llms.txt)', type: 'Text' },
      {
        apiId: 'aiCrawlers',
        name: 'AI crawlers',
        type: 'Symbol',
        localized: false,
        validations: { in: ['allow', 'disallow'] },
      },
      {
        apiId: 'nav',
        name: 'Navigation',
        type: 'Array',
        localized: false,
        items: {
          type: 'Component',
          fields: [
            { apiId: 'label', name: 'Label', type: 'Symbol', required: true },
            entryLink('link', 'Links to', ['page', 'article']),
            { apiId: 'url', name: 'Or URL', type: 'Symbol' },
          ] as unknown as FieldDef[],
        },
      },
      { apiId: 'footer', name: 'Footer', type: 'RichText' },
    ]),
  },
  {
    apiId: 'person',
    name: 'Person',
    displayField: 'name',
    fields: fields([
      { apiId: 'name', name: 'Name', type: 'Symbol', required: true, localized: false },
    ]),
  },
  {
    apiId: 'fragment',
    name: 'Shared section',
    displayField: 'title',
    fields: fields([
      { apiId: 'title', name: 'Internal name', type: 'Symbol', required: true, localized: false },
      sections((VARIANTS ?? []).filter((v) => v.apiId !== 'fragment')),
    ]),
  },
  {
    apiId: 'page',
    name: 'Page',
    displayField: 'title',
    urlPattern: '/{slug}',
    fields: fields([
      { apiId: 'title', name: 'Title', type: 'Symbol', required: true },
      {
        apiId: 'slug',
        name: 'Slug ("home" is the home page)',
        type: 'Slug',
        required: true,
        unique: true,
      },
      sections(),
      { apiId: 'body', name: 'Body (when there are no sections)', type: 'RichText' },
      seo,
    ]),
  },
  {
    apiId: 'article',
    name: 'Article',
    displayField: 'title',
    urlPattern: '/blog/{slug}',
    fields: fields([
      { apiId: 'title', name: 'Title', type: 'Symbol', required: true },
      { apiId: 'slug', name: 'Slug', type: 'Slug', required: true, unique: true },
      {
        apiId: 'publishedAt',
        name: 'Publish date',
        type: 'Date',
        required: true,
        localized: false,
      },
      entryLink('author', 'Author', ['person']),
      asset('image', 'Image'),
      { apiId: 'body', name: 'Body', type: 'RichText', required: true },
      seo,
    ]),
  },
];
