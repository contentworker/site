import type { Entry } from '../types.ts';

/**
 * robots.txt from siteSettings. AI crawlers are named one by one, so a site can opt out of
 * answer engines and model training (siteSettings.aiCrawlers = "disallow") without leaving
 * search. The showcase default is "allow": being cited is the point of GEO.
 */
export const AI_CRAWLERS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-SearchBot',
  'Claude-User',
  'PerplexityBot',
  'Perplexity-User',
  'Google-Extended',
  'Applebot-Extended',
  'CCBot',
  'meta-externalagent',
  'Bytespider',
];

export function robotsTxt({
  origin,
  settings,
}: {
  origin: string;
  settings: Entry | null;
}): string {
  const policy =
    settings?.fields?.aiCrawlers === 'disallow' ? 'Disallow: /' : 'Allow: /\nDisallow: /__';
  const lines = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /__',
    '',
    ...AI_CRAWLERS.flatMap((agent) => [`User-agent: ${agent}`]),
    policy,
    '',
    `Sitemap: ${origin}/sitemap.xml`,
    '',
  ];
  return lines.join('\n');
}
