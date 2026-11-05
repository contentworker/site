/**
 * The starter's content: what https://contentworker.site shows, and what every new site begins
 * with. References between items use `{ $entry: key }` and `{ $asset: key }`; the seed resolves
 * them to ContentWorker links once the targets exist.
 */
import { a, b, button, code, doc, h2, p, pre, ul } from './rich-text.ts';

export interface SeedAsset {
  key: string;
  fileName: string;
  title: string;
  alt: string;
  /** Generated placeholder size (replace with real images in the CMS). */
  width: number;
  height: number;
}

export interface SeedEntry {
  key: string;
  contentType: string;
  fields: Record<string, unknown>;
}

export interface SeedContent {
  assets: SeedAsset[];
  entries: SeedEntry[];
}

const $asset = (key: string) => ({ $asset: key });
const $entry = (key: string) => ({ $entry: key });

const INTEGRATION = `// wrangler.jsonc
{
  "main": "node_modules/@contentworker/frontend/src/entry.ts",
  "vars": { "CONTENTWORKER": "https://cdn.<your domain>/<space>/<env>" }
}`;

export const starterContent: SeedContent = {
  assets: [
    {
      key: 'hero',
      fileName: 'edge.png',
      title: 'Edge',
      alt: 'An abstract gradient in blue and violet',
      width: 2400,
      height: 1200,
    },
    {
      key: 'cache',
      fileName: 'cache.png',
      title: 'Cache',
      alt: 'An abstract gradient in teal',
      width: 1600,
      height: 800,
    },
    {
      key: 'blocks',
      fileName: 'blocks.png',
      title: 'Blocks',
      alt: 'An abstract gradient in amber',
      width: 1600,
      height: 800,
    },
  ],
  entries: [
    { key: 'team', contentType: 'person', fields: { name: 'The ContentWorker team' } },
    {
      key: 'signup',
      contentType: 'fragment',
      fields: {
        title: 'Get started band',
        sections: [
          {
            _type: 'cta',
            heading: 'Start a site in two files',
            body: doc(
              p('A package.json and a wrangler.jsonc. Everything else ships in the runtime.'),
            ),
            label: 'Read the integration guide',
            link: $entry('integrate'),
            variant: 'accent',
          },
        ],
      },
    },
    {
      key: 'integrate',
      contentType: 'page',
      fields: {
        title: 'Integrate',
        slug: 'integrate',
        seo: {
          description:
            'Put a ContentWorker site on Cloudflare with a package.json and a wrangler.jsonc.',
        },
        sections: [
          {
            _type: 'richText',
            body: doc(
              p(
                'A site is the ',
                code('@contentworker/frontend'),
                ' package plus one setting that names your space. The runtime owns rendering, caching, preview, SEO and every block, so you update it like any other dependency.',
              ),
              h2('Two files'),
              pre(INTEGRATION),
              p(
                'Then set the ',
                code('CONTENTWORKER_KEY'),
                ' secret to a Content Delivery API key and deploy.',
              ),
              h2('When you customise'),
              ul(
                [
                  'Your own files go in ',
                  code('public/'),
                  ' and win over the runtime’s at the same path.',
                ],
                ['Your own blocks and URLs go in ', code('defineSite({ blocks, routes })'), '.'],
              ),
              button('Browse the blocks', '/blocks'),
            ),
          },
        ],
      },
    },
    {
      key: 'blocks',
      contentType: 'page',
      fields: {
        title: 'Blocks',
        slug: 'blocks',
        seo: {
          description:
            'Every block in the starter, rendered by the edge and readable with JavaScript off.',
        },
        sections: [
          {
            _type: 'cards',
            heading: 'The blocks',
            items: [
              {
                title: 'Hero',
                body: doc(
                  p('A headline over an image that is fetched first and never shifts layout.'),
                ),
                image: $asset('hero'),
              },
              {
                title: 'Cards',
                body: doc(
                  p('A grid of linked cards. The whole card is clickable through one real link.'),
                ),
                image: $asset('blocks'),
              },
              {
                title: 'FAQ',
                body: doc(
                  p('Native disclosures plus FAQPage structured data that answer engines quote.'),
                ),
                image: $asset('cache'),
              },
            ],
          },
          {
            _type: 'columns',
            columns: [
              {
                body: doc(
                  h2('Columns'),
                  p(
                    'Two to four columns that stack on small screens. A column holding only an image is styled as one.',
                  ),
                ),
              },
              { image: $asset('blocks') },
            ],
          },
          {
            _type: 'faq',
            heading: 'Questions',
            items: [
              {
                question: 'Does the site need JavaScript?',
                answer: doc(
                  p(
                    'No. Every block is finished HTML from the edge. Scripts only add behaviour, such as closing the menu with Escape.',
                  ),
                ),
              },
              {
                question: 'How fast does a publish go live?',
                answer: doc(
                  p(
                    'About a minute. ContentWorker sends a signed webhook and the site purges exactly the pages that used what changed.',
                  ),
                ),
              },
              {
                question: 'Can agents read it?',
                answer: doc(p('Yes. Every page has a Markdown version, and llms.txt lists them.')),
              },
            ],
          },
          { _type: 'fragment', fragment: $entry('signup') },
        ],
      },
    },
    {
      key: 'home',
      contentType: 'page',
      fields: {
        title: 'ContentWorker',
        slug: 'home',
        seo: {
          description:
            'A website for ContentWorker content: rendered and cached at the edge, Lighthouse 100 on every page.',
        },
        sections: [
          {
            _type: 'hero',
            heading: 'Content, rendered at the edge',
            lead: doc(
              p(
                'A ContentWorker site renders on Cloudflare, serves from the edge cache, and scores 100 in every Lighthouse category on mobile and desktop.',
              ),
              button('Read the integration guide', '/integrate'),
            ),
            image: $asset('hero'),
          },
          {
            _type: 'cards',
            heading: 'Why it’s fast',
            items: [
              {
                title: 'Finished HTML',
                body: doc(
                  p(
                    'Pages arrive complete. Nothing is assembled in the browser, so they read with JavaScript off.',
                  ),
                ),
                link: $entry('blocks'),
              },
              {
                title: 'Edge cache, exact purges',
                body: doc(
                  p(
                    'Pages are cached at the edge and purged by tag when the content they used is published.',
                  ),
                ),
                image: $asset('cache'),
              },
              {
                title: 'A budget CI enforces',
                body: doc(
                  p(
                    'Every pull request is measured with Lighthouse on mobile and desktop, and fails below 100.',
                  ),
                ),
              },
            ],
          },
          { _type: 'fragment', fragment: $entry('signup') },
        ],
      },
    },
    {
      key: 'edge-article',
      contentType: 'article',
      fields: {
        title: 'Why pages render at the edge',
        slug: 'why-pages-render-at-the-edge',
        publishedAt: '2026-11-01',
        author: $entry('team'),
        image: $asset('hero'),
        seo: {
          description:
            'Rendering per request and caching at the edge gives fresh content at static-site speed.',
        },
        body: doc(
          p(
            'A ContentWorker site renders each page in a Worker the first time it is asked for, then serves it from Cloudflare’s cache. The next visitor anywhere gets it from the nearest data center without running any code.',
          ),
          h2('Fresh without rebuilds'),
          p(
            'Publishing in the CMS sends a signed webhook. The site purges the pages tagged with what changed, and only those, so there is no site rebuild and no stale page past about a minute.',
          ),
          h2('Finished before it leaves'),
          p(
            'Sections, images, buttons and structured data are all decided in the Worker. The browser receives finished HTML and only adds behaviour. ',
            a('See every block', '/blocks'),
            '.',
          ),
        ),
      },
    },
    {
      key: 'agents-article',
      contentType: 'article',
      fields: {
        title: 'Readable by people and by agents',
        slug: 'readable-by-people-and-agents',
        publishedAt: '2026-11-02',
        author: $entry('team'),
        image: $asset('blocks'),
        seo: {
          description:
            'Every page has a Markdown version and llms.txt lists them, so answer engines can cite the site.',
        },
        body: doc(
          p(
            'Answer engines read pages differently from browsers. A ContentWorker site serves the same content as HTML for people and as Markdown for agents, generated at the edge from the same structured content.',
          ),
          ul(
            ['Add ', code('.md'), ' to any page URL, or ask for ', code('text/markdown'), '.'],
            [code('/llms.txt'), ' lists every page with a summary.'],
            ['FAQ blocks emit ', b('FAQPage'), ' structured data.'],
          ),
        ),
      },
    },
    {
      key: 'settings',
      contentType: 'siteSettings',
      fields: {
        name: 'ContentWorker',
        description: 'The ContentWorker site starter: edge-rendered, edge-cached, Lighthouse 100.',
        llmsSummary:
          'ContentWorker is a headless CMS on Cloudflare. This site is its frontend starter: pages are rendered by a Worker from the Delivery API and served from the edge cache.',
        aiCrawlers: 'allow',
        nav: [
          { label: 'Blocks', link: $entry('blocks') },
          { label: 'Integrate', link: $entry('integrate') },
          { label: 'Blog', url: '/blog' },
        ],
        footer: doc(
          p(
            'Built with ContentWorker on Cloudflare. ',
            a('Docs', 'https://docs.contentworker.app'),
            '.',
          ),
        ),
      },
    },
  ],
};
