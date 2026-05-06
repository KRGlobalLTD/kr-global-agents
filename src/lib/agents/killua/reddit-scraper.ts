import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ---- Types ----

export interface RedditPost {
  title:    string;
  score:    number;
  author:   string;
  url:      string;
  selftext: string;
  subreddit: string;
}

export interface ScrapeResult {
  source:   'apify' | 'jina';
  posts:    RedditPost[];
  saved:    number;
  subreddit: string;
}

// ---- Jina Reader — scrape Reddit JSON directement ----

async function scrapeViaJina(subreddit: string, limit: number): Promise<RedditPost[]> {
  const jinaKey = process.env.JINA_API_KEY;
  if (!jinaKey) throw new Error('JINA_API_KEY manquant');

  const redditUrl = `https://www.reddit.com/r/${subreddit}/new.json?limit=${limit}`;

  const res = await fetch(`https://r.jina.ai/${redditUrl}`, {
    headers: {
      Authorization:    `Bearer ${jinaKey}`,
      Accept:           'application/json',
      'X-Return-Format': 'json',
    },
  });

  if (!res.ok) throw new Error(`Jina ${res.status}: ${await res.text()}`);

  const wrapper = (await res.json()) as { data?: { content?: string } };
  const contentStr = wrapper.data?.content ?? '';
  if (!contentStr) throw new Error('Jina retourne data.content vide');

  const reddit = JSON.parse(contentStr) as {
    data: { children: Array<{ data: Record<string, unknown> }> };
  };

  return (reddit.data?.children ?? []).map(c => ({
    title:    (c.data['title']    as string) ?? '',
    score:    (c.data['score']    as number) ?? 0,
    author:   (c.data['author']   as string) ?? '',
    url:      (c.data['url']      as string) ?? '',
    selftext: ((c.data['selftext'] as string) ?? '').slice(0, 500),
    subreddit,
  }));
}

// ---- Apify — fallback si APIFY_API_TOKEN + acteur loué ----

async function scrapeViaApify(subreddit: string, limit: number): Promise<RedditPost[]> {
  const token     = process.env.APIFY_API_TOKEN;
  const actorSlug = process.env.APIFY_REDDIT_ACTOR ?? 'trudax~reddit-scraper';
  if (!token) throw new Error('APIFY_API_TOKEN manquant');

  // Lancer le run
  const runRes = await fetch(
    `https://api.apify.com/v2/acts/${actorSlug}/runs?token=${token}`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        startUrls: [{ url: `https://www.reddit.com/r/${subreddit}/new/` }],
        maxItems:  limit,
      }),
    }
  );

  if (!runRes.ok) {
    const err = (await runRes.json()) as { error?: { type?: string; message?: string } };
    throw new Error(`Apify run: ${err.error?.type} — ${err.error?.message}`);
  }

  const runData = (await runRes.json()) as { data: { id: string; defaultDatasetId: string } };
  const { id: runId, defaultDatasetId } = runData.data;

  // Attendre la fin du run (max 60s)
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const statusRes = await fetch(
      `https://api.apify.com/v2/acts/${actorSlug}/runs/${runId}?token=${token}`
    );
    const statusData = (await statusRes.json()) as { data: { status: string } };
    if (statusData.data.status === 'SUCCEEDED') break;
    if (statusData.data.status === 'FAILED') throw new Error('Apify run échoué');
  }

  // Récupérer les items du dataset
  const dataRes = await fetch(
    `https://api.apify.com/v2/datasets/${defaultDatasetId}/items?token=${token}&limit=${limit}`
  );
  if (!dataRes.ok) throw new Error(`Apify dataset ${dataRes.status}`);

  const items = (await dataRes.json()) as Record<string, unknown>[];

  return items.map(item => ({
    title:    (item['title']    as string) ?? '',
    score:    (item['score']    as number) ?? 0,
    author:   (item['author']   as string) ?? '',
    url:      (item['url']      as string) ?? '',
    selftext: ((item['selftext'] as string) ?? '').slice(0, 500),
    subreddit,
  }));
}

// ---- Calcul du score de pertinence pour KR Global ----

const KR_KEYWORDS = [
  'ai agency', 'ai automation', 'artificial intelligence', 'automation',
  'saas', 'b2b', 'lead generation', 'marketing', 'chatgpt', 'llm',
  'langchain', 'agent', 'startup', 'agency', 'freelance', 'outsourcing',
  'grok', 'gemini', 'claude', 'openai', 'security', 'jailbreak',
];

function computeRelevance(post: RedditPost): number {
  const text  = `${post.title} ${post.selftext}`.toLowerCase();
  const hits  = KR_KEYWORDS.filter(kw => text.includes(kw)).length;
  const base  = Math.min(hits / 3, 1);               // 0–1 selon mots-clés
  const boost = post.score > 100 ? 0.15 : post.score > 20 ? 0.08 : 0;
  return Math.min(Math.round((base + boost) * 100) / 100, 1.0);
}

function buildTags(post: RedditPost): string[] {
  const text = `${post.title} ${post.selftext}`.toLowerCase();
  const tags: string[] = [`r/${post.subreddit}`];
  if (text.includes('security') || text.includes('jailbreak') || text.includes('hack'))
    tags.push('security');
  if (text.includes('agent') || text.includes('autonomous') || text.includes('llm'))
    tags.push('AI agents');
  if (text.includes('saas') || text.includes('startup'))
    tags.push('SaaS');
  if (text.includes('marketing') || text.includes('lead'))
    tags.push('marketing');
  if (text.includes('automation'))
    tags.push('automation');
  if (post.score > 50)
    tags.push('viral');
  return [...new Set(tags)];
}

// ---- Sauvegarde dans research_insights ----

async function saveInsights(posts: RedditPost[], source: string): Promise<number> {
  let saved = 0;

  for (const post of posts) {
    if (!post.title.trim()) continue;

    const relevance = computeRelevance(post);
    const tags      = buildTags(post);
    const content   = [
      post.selftext.trim() ? post.selftext : '(pas de texte)',
      `Score Reddit : ${post.score} | Auteur : u/${post.author}`,
      `URL : ${post.url}`,
    ].join('\n');

    const { error } = await supabase.from('research_insights').insert({
      agent_name:      'KILLUA',
      source:          `Reddit ${source} r/${post.subreddit}`,
      topic:           post.title.slice(0, 200),
      content,
      relevance_score: relevance,
      tags,
    });

    if (error && error.code !== '23505') {
      await supabase.from('alerts').insert({
        agent_name: 'KILLUA',
        level:      'WARNING',
        message:    `Erreur insertion insight Reddit : ${error.message.slice(0, 150)}`,
      });
    } else if (!error) {
      saved++;
    }
  }

  return saved;
}

// ---- Point d'entrée principal ----

export async function scrapeReddit(
  subreddit = 'artificial',
  limit     = 10
): Promise<ScrapeResult> {
  let posts:  RedditPost[] = [];
  let source: 'apify' | 'jina' = 'jina';

  // Tenter Apify en priorité si token dispo
  const apifyToken = process.env.APIFY_API_TOKEN;
  if (apifyToken) {
    try {
      posts  = await scrapeViaApify(subreddit, limit);
      source = 'apify';
    } catch (apifyErr) {
      const msg = apifyErr instanceof Error ? apifyErr.message : 'Erreur Apify';
      await supabase.from('alerts').insert({
        agent_name: 'KILLUA',
        level:      'INFO',
        message:    `Apify indisponible (${msg.slice(0, 100)}), fallback Jina`,
      });
      posts  = await scrapeViaJina(subreddit, limit);
      source = 'jina';
    }
  } else {
    posts  = await scrapeViaJina(subreddit, limit);
    source = 'jina';
  }

  const saved = await saveInsights(posts, source === 'apify' ? 'via Apify' : 'via Jina');

  await supabase.from('alerts').insert({
    agent_name: 'KILLUA',
    level:      'INFO',
    message:    `Reddit r/${subreddit} : ${posts.length} posts scrapés via ${source}, ${saved} insights sauvegardés`,
  });

  return { source, posts, saved, subreddit };
}
