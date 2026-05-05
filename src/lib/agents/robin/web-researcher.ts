import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const APIFY_BASE = 'https://api.apify.com/v2';

export interface ResearchResult {
  title:   string;
  url:     string;
  snippet: string;
  source:  string;
}

function getToken(): string | null {
  return process.env.APIFY_API_TOKEN ?? null;
}

async function log(level: string, message: string): Promise<void> {
  await supabase.from('alerts').insert({ agent_name: 'ROBIN', level, message });
}

// ── Run Apify actor and wait for results ────────────────────────────────────

async function runApifyActor(
  actorId: string,
  input:   Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  const token = getToken();
  if (!token) {
    await log('WARNING', 'APIFY_API_TOKEN manquant — scraping ignoré');
    return [];
  }

  // Start run
  const startRes = await fetch(
    `${APIFY_BASE}/acts/${actorId}/runs?token=${token}&waitForFinish=60`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(input),
    },
  );

  if (!startRes.ok) {
    await log('WARNING', `Apify actor ${actorId} start failed: ${startRes.status}`);
    return [];
  }

  const run = (await startRes.json()) as { data: { id: string; defaultDatasetId: string } };
  const datasetId = run.data?.defaultDatasetId;
  if (!datasetId) return [];

  // Fetch results
  const itemsRes = await fetch(
    `${APIFY_BASE}/datasets/${datasetId}/items?token=${token}&limit=20&clean=true`,
  );
  if (!itemsRes.ok) return [];

  return (await itemsRes.json()) as Record<string, unknown>[];
}

// ── Google Search ────────────────────────────────────────────────────────────

export async function researchTopic(query: string): Promise<ResearchResult[]> {
  const items = await runApifyActor('apify/google-search-scraper', {
    queries:            query,
    maxPagesPerQuery:   1,
    resultsPerPage:     10,
    languageCode:       'en',
    countryCode:        'gb',
    mobileResults:      false,
  });

  const results: ResearchResult[] = [];

  for (const item of items) {
    const organicResults = (item['organicResults'] as Record<string, unknown>[] | undefined) ?? [];
    for (const r of organicResults) {
      results.push({
        title:   String(r['title']   ?? ''),
        url:     String(r['url']     ?? ''),
        snippet: String(r['description'] ?? ''),
        source:  'google',
      });
    }
  }

  await log('INFO', `researchTopic "${query}" : ${results.length} résultats Google`);
  return results;
}

// ── Reddit Scraper ───────────────────────────────────────────────────────────

export async function scrapeReddit(subreddit: string, limit = 15): Promise<ResearchResult[]> {
  const items = await runApifyActor('trudax/reddit-scraper-lite', {
    startUrls:  [{ url: `https://www.reddit.com/r/${subreddit}/hot/` }],
    maxItems:   limit,
    proxy:      { useApifyProxy: true },
  });

  const results: ResearchResult[] = items.map(item => ({
    title:   String(item['title']     ?? ''),
    url:     String(item['url']       ?? `https://reddit.com/r/${subreddit}`),
    snippet: String(item['selftext']  ?? item['body'] ?? '').slice(0, 500),
    source:  `reddit/r/${subreddit}`,
  }));

  await log('INFO', `scrapeReddit r/${subreddit} : ${results.length} posts`);
  return results;
}

// ── Twitter/X Hashtag Scraper ────────────────────────────────────────────────

export async function scrapeTwitterHashtag(hashtag: string, limit = 20): Promise<ResearchResult[]> {
  const items = await runApifyActor('quacker/twitter-scraper', {
    searchTerms:    [`#${hashtag}`],
    maxTweets:      limit,
    addUserInfo:    false,
    proxyConfig:    { useApifyProxy: true },
  });

  const results: ResearchResult[] = items.map(item => ({
    title:   `@${String(item['author_id'] ?? 'twitter')}`,
    url:     String(item['url'] ?? 'https://twitter.com'),
    snippet: String(item['full_text'] ?? item['text'] ?? '').slice(0, 500),
    source:  `twitter/#${hashtag}`,
  }));

  await log('INFO', `scrapeTwitter #${hashtag} : ${results.length} tweets`);
  return results;
}

// ── Batch AI research ────────────────────────────────────────────────────────

export async function researchAITrends(): Promise<ResearchResult[]> {
  const [google, reddit1, reddit2, reddit3, twitter] = await Promise.all([
    researchTopic('AI agency UK 2025 trends'),
    scrapeReddit('artificial'),
    scrapeReddit('MachineLearning'),
    scrapeReddit('startups'),
    scrapeTwitterHashtag('AIAgency'),
  ]);

  return [...google, ...reddit1, ...reddit2, ...reddit3, ...twitter];
}
