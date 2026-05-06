import { createClient } from '@supabase/supabase-js';
import type { PubPlatform } from './format-adapter';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const PUBLER_BASE = 'https://app.publer.io/api/v1';

// ─── Types Publer Analytics ───────────────────────────────────────────────────

interface PublerPostAnalytics {
  id:           string;
  impressions?: number;
  reach?:       number;
  likes?:       number;
  comments?:    number;
  shares?:      number;
  clicks?:      number;
}

interface PublerAnalyticsResponse {
  data?: PublerPostAnalytics[];
}

// ─── Types base ───────────────────────────────────────────────────────────────

interface ScheduledPostRow {
  id:              string;
  platform:        string;
  publer_post_id:  string | null;
  published_at:    string | null;
}

interface PlatformStats {
  posts:      number;
  impressions: number;
  likes:      number;
  comments:   number;
  shares:     number;
  clicks:     number;
}

// ─── Récupération stats Publer ────────────────────────────────────────────────

async function fetchPublerAnalytics(accountId: string, since: string): Promise<PublerPostAnalytics[]> {
  const params = new URLSearchParams({
    account_id: accountId,
    since,
    per_page:   '50',
  });

  const res = await fetch(`${PUBLER_BASE}/analytics/posts?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${process.env.PUBLER_API_KEY}`,
    },
  });

  if (!res.ok) return [];

  const data = (await res.json()) as PublerAnalyticsResponse;
  return data.data ?? [];
}

function getPublerAccountId(platform: string): string | null {
  const map: Record<string, string | undefined> = {
    linkedin_company:  process.env.PUBLER_ACCOUNT_LINKEDIN_COMPANY,
    linkedin_karim:    process.env.PUBLER_ACCOUNT_LINKEDIN_KARIM,
    linkedin_raphael:  process.env.PUBLER_ACCOUNT_LINKEDIN_RAPHAEL,
    instagram:         process.env.PUBLER_ACCOUNT_INSTAGRAM,
    tiktok:            process.env.PUBLER_ACCOUNT_TIKTOK,
    facebook:          process.env.PUBLER_ACCOUNT_FACEBOOK,
  };
  return map[platform] ?? null;
}

// ─── Rapport hebdomadaire ─────────────────────────────────────────────────────

export interface WeeklyStats {
  period:    string;
  platforms: Record<string, PlatformStats>;
  totals:    PlatformStats;
}

export async function getWeeklyStats(): Promise<WeeklyStats> {
  const since   = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const period  = `${since.slice(0, 10)} → ${new Date().toISOString().slice(0, 10)}`;

  // Posts publiés cette semaine
  const { data: posts } = await supabase
    .from('sanji_scheduled_posts')
    .select('id, platform, publer_post_id, published_at')
    .eq('statut', 'published')
    .gte('published_at', since);

  const rows     = (posts ?? []) as ScheduledPostRow[];
  const platforms: Record<string, PlatformStats> = {};

  // Grouper par plateforme
  const byPlatform: Record<string, ScheduledPostRow[]> = {};
  for (const r of rows) {
    if (!byPlatform[r.platform]) byPlatform[r.platform] = [];
    byPlatform[r.platform].push(r);
  }

  for (const [platform, platformPosts] of Object.entries(byPlatform)) {
    const accountId = getPublerAccountId(platform);
    let publerData:  PublerPostAnalytics[] = [];

    if (accountId) {
      publerData = await fetchPublerAnalytics(accountId, since).catch(() => []);
    }

    // Indexer par Publer post ID
    const statsById = new Map<string, PublerPostAnalytics>();
    for (const s of publerData) statsById.set(s.id, s);

    let impressions = 0, likes = 0, comments = 0, shares = 0, clicks = 0;

    for (const post of platformPosts) {
      const s = post.publer_post_id ? statsById.get(post.publer_post_id) : undefined;
      impressions += s?.impressions ?? s?.reach ?? 0;
      likes       += s?.likes    ?? 0;
      comments    += s?.comments ?? 0;
      shares      += s?.shares   ?? 0;
      clicks      += s?.clicks   ?? 0;
    }

    platforms[platform] = { posts: platformPosts.length, impressions, likes, comments, shares, clicks };
  }

  const totals: PlatformStats = { posts: 0, impressions: 0, likes: 0, comments: 0, shares: 0, clicks: 0 };
  for (const s of Object.values(platforms)) {
    totals.posts      += s.posts;
    totals.impressions += s.impressions;
    totals.likes      += s.likes;
    totals.comments   += s.comments;
    totals.shares     += s.shares;
    totals.clicks     += s.clicks;
  }

  return { period, platforms, totals };
}

// ─── Envoi rapport Slack lundi 8h ────────────────────────────────────────────

export async function sendWeeklyReport(): Promise<void> {
  const stats   = await getWeeklyStats();
  const webhook = process.env.SLACK_WEBHOOK_CONTENU;

  if (!webhook) {
    await supabase.from('alerts').insert({
      agent_name: 'SANJI',
      level:      'WARNING',
      message:    'SLACK_WEBHOOK_CONTENU non configuré — rapport hebdo non envoyé',
    });
    return;
  }

  const lines: string[] = [
    `*SANJI — Rapport hebdomadaire réseaux sociaux*`,
    `Période : ${stats.period}`,
    '',
    '*Par plateforme :*',
  ];

  for (const [platform, s] of Object.entries(stats.platforms)) {
    lines.push(
      `• *${platform}* : ${s.posts} posts | ${s.impressions} impressions | ` +
      `${s.likes} likes | ${s.comments} commentaires | ${s.shares} partages`
    );
  }

  lines.push(
    '',
    `*Totaux* : ${stats.totals.posts} posts | ${stats.totals.impressions} impressions | ` +
    `${stats.totals.likes} likes | ${stats.totals.clicks} clics`
  );

  const res = await fetch(webhook, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      text:       lines.join('\n'),
      username:   'SANJI',
      icon_emoji: ':bar_chart:',
    }),
  });

  if (!res.ok) {
    await supabase.from('alerts').insert({
      agent_name: 'SANJI',
      level:      'WARNING',
      message:    `Rapport hebdo Slack échoué : ${res.status}`,
    });
    return;
  }

  await supabase.from('alerts').insert({
    agent_name: 'SANJI',
    level:      'INFO',
    message:    `Rapport hebdo envoyé : ${stats.totals.posts} posts, ${stats.totals.impressions} impressions`,
  });
}
