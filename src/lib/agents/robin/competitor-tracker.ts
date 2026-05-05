import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export interface Competitor {
  name:     string;
  website:  string;
  focus:    string;
  location: string;
}

export interface CompetitorIntel {
  competitor:   Competitor;
  pages_found:  number;
  key_offers:   string[];
  scraped_text: string;
  scraped_at:   string;
}

// Agences IA UK concurrentes directes de KR Global
const COMPETITORS: Competitor[] = [
  { name: 'Faculty AI',    website: 'https://faculty.ai',          focus: 'Enterprise AI consulting', location: 'London' },
  { name: 'Satalia',       website: 'https://satalia.com',         focus: 'AI & optimisation',        location: 'London' },
  { name: 'Brainpool AI',  website: 'https://brainpool.ai',        focus: 'AI talent & consulting',   location: 'London' },
  { name: 'Aire Logic',    website: 'https://airelogic.com',       focus: 'Digital & AI agency',      location: 'Leeds'  },
  { name: 'Polyglot AI',   website: 'https://polyglot.ai',         focus: 'AI automation agency',     location: 'London' },
  { name: 'Amplified AI',  website: 'https://amplified.ai',        focus: 'AI marketing agency',      location: 'London' },
];

const KR_GLOBAL_PROFILE = {
  name:          'KR Global Solutions Ltd',
  focus:         'AI agents automation for SMBs',
  price_range:   '500-5000 GBP/month',
  differentiators: [
    '28 autonomous AI agents',
    'Full-stack automation (marketing, sales, ops)',
    'Transparent pricing',
    'London-based, Moroccan expertise',
  ],
};

async function scrapeWebsite(url: string): Promise<string> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) return '';

  try {
    const startRes = await fetch(
      `https://api.apify.com/v2/acts/apify~web-scraper/runs?token=${token}&waitForFinish=45`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startUrls:          [{ url }],
          maxCrawlingDepth:   1,
          maxPagesPerCrawl:   3,
          pageFunction:       `async function pageFunction(context) { return { text: document.body.innerText.slice(0, 2000), url: context.request.url }; }`,
        }),
      },
    );

    if (!startRes.ok) return '';

    const run       = (await startRes.json()) as { data: { defaultDatasetId: string } };
    const datasetId = run.data?.defaultDatasetId;
    if (!datasetId) return '';

    const itemsRes = await fetch(
      `https://api.apify.com/v2/datasets/${datasetId}/items?token=${token}&limit=3&clean=true`,
    );
    if (!itemsRes.ok) return '';

    const items = (await itemsRes.json()) as Record<string, unknown>[];
    return items.map(i => String(i['text'] ?? '')).join('\n\n').slice(0, 3000);
  } catch {
    return '';
  }
}

function extractKeyOffers(text: string): string[] {
  const keywords = [
    'pricing', 'price', 'plan', 'package', 'service', 'solution',
    'offer', 'enterprise', 'startup', 'monthly', 'annual', 'consulting',
    'automation', 'integration', 'AI agent', 'LLM', 'GPT',
  ];

  const sentences = text.split(/[.\n]/).filter(s => s.trim().length > 20);
  return sentences
    .filter(s => keywords.some(kw => s.toLowerCase().includes(kw)))
    .slice(0, 5)
    .map(s => s.trim().slice(0, 150));
}

export async function trackCompetitors(): Promise<CompetitorIntel[]> {
  const results: CompetitorIntel[] = [];

  for (const competitor of COMPETITORS) {
    const text     = await scrapeWebsite(competitor.website);
    const offers   = extractKeyOffers(text);
    const intel: CompetitorIntel = {
      competitor,
      pages_found:  text.length > 100 ? 1 : 0,
      key_offers:   offers,
      scraped_text: text.slice(0, 1000),
      scraped_at:   new Date().toISOString(),
    };

    // Sauvegarder dans research_insights
    await supabase.from('research_insights').insert({
      source:          competitor.website,
      topic:           `competitor:${competitor.name}`,
      content:         JSON.stringify({ offers, text: text.slice(0, 500) }),
      relevance_score: offers.length > 2 ? 0.8 : 0.4,
      tags:            ['competitor', 'UK', competitor.location.toLowerCase()],
    });

    results.push(intel);
  }

  await supabase.from('alerts').insert({
    agent_name: 'ROBIN',
    level:      'INFO',
    message:    `Concurrents analysés : ${results.length} — ${results.filter(r => r.pages_found > 0).length} scrapés`,
  });

  return results;
}

export function compareWithKRGlobal(intel: CompetitorIntel[]): string {
  const scraped = intel.filter(c => c.pages_found > 0);

  const lines = [
    `# Analyse concurrentielle — KR Global vs marché UK`,
    ``,
    `## KR Global Solutions Ltd`,
    `- Focus : ${KR_GLOBAL_PROFILE.focus}`,
    `- Différenciateurs : ${KR_GLOBAL_PROFILE.differentiators.join(', ')}`,
    ``,
    `## Concurrents analysés (${scraped.length}/${intel.length})`,
    ...scraped.map(c => [
      `### ${c.competitor.name} (${c.competitor.location})`,
      `- Focus : ${c.competitor.focus}`,
      `- Offres détectées : ${c.key_offers.slice(0, 2).join(' | ') || 'non détectées'}`,
    ].join('\n')),
  ];

  return lines.join('\n');
}
