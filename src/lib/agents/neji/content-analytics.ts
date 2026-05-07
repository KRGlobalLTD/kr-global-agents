import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export type Period = 'week' | 'month' | 'quarter';

export interface ContentPerformance {
  content_id:      string;
  titre:           string;
  plateforme:      string;
  vues:            number;
  clics:           number;
  conversions:     number;
  engagement_rate: number;
  created_at:      string;
}

export interface ContentAnalyticsSummary {
  period:              Period;
  total_published:     number;
  total_views:         number;
  total_clicks:        number;
  total_conversions:   number;
  avg_engagement_rate: number;
  top_content:         ContentPerformance[];
  by_platform:         Record<string, { count: number; views: number; clicks: number }>;
}

function periodToDate(period: Period): Date {
  const now = new Date();
  switch (period) {
    case 'week':    return new Date(now.getTime() - 7  * 24 * 60 * 60 * 1000);
    case 'month':   return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case 'quarter': return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  }
}

export async function analyzeContentPerformance(period: Period = 'month'): Promise<ContentAnalyticsSummary> {
  const since = periodToDate(period).toISOString();

  const { data: contentData, error: contentError } = await supabase
    .from('content')
    .select('id, titre, plateforme, statut, created_at')
    .eq('statut', 'publié')
    .gte('created_at', since);

  if (contentError) throw new Error(`content query: ${contentError.message}`);

  const content    = contentData ?? [];
  const contentIds = content.map(c => c.id as string);

  let metrics: Array<{ content_id: string; vues: number; clics: number; conversions: number }> = [];

  if (contentIds.length > 0) {
    const { data: metricsData, error: metricsError } = await supabase
      .from('content_metrics')
      .select('content_id, vues, clics, conversions')
      .in('content_id', contentIds);

    if (metricsError) throw new Error(`content_metrics query: ${metricsError.message}`);
    metrics = (metricsData ?? []) as typeof metrics;
  }

  const metricsMap = new Map(metrics.map(m => [m.content_id, m]));

  const enriched: ContentPerformance[] = content.map(c => {
    const m           = metricsMap.get(c.id as string);
    const vues        = m?.vues        ?? 0;
    const clics       = m?.clics       ?? 0;
    const conversions = m?.conversions ?? 0;
    return {
      content_id:      c.id as string,
      titre:           c.titre as string,
      plateforme:      c.plateforme as string,
      vues,
      clics,
      conversions,
      engagement_rate: vues > 0 ? Math.round((clics / vues) * 10000) / 100 : 0,
      created_at:      c.created_at as string,
    };
  });

  const totalViews       = enriched.reduce((s, c) => s + c.vues, 0);
  const totalClicks      = enriched.reduce((s, c) => s + c.clics, 0);
  const totalConversions = enriched.reduce((s, c) => s + c.conversions, 0);
  const avgEngagement    = enriched.length
    ? Math.round(enriched.reduce((s, c) => s + c.engagement_rate, 0) / enriched.length * 100) / 100
    : 0;

  const byPlatform: Record<string, { count: number; views: number; clicks: number }> = {};
  for (const c of enriched) {
    const p = (c.plateforme as string) || 'unknown';
    if (!byPlatform[p]) byPlatform[p] = { count: 0, views: 0, clicks: 0 };
    byPlatform[p].count++;
    byPlatform[p].views  += c.vues;
    byPlatform[p].clicks += c.clics;
  }

  const topContent = [...enriched].sort((a, b) => b.vues - a.vues).slice(0, 5);

  return {
    period,
    total_published:     enriched.length,
    total_views:         totalViews,
    total_clicks:        totalClicks,
    total_conversions:   totalConversions,
    avg_engagement_rate: avgEngagement,
    top_content:         topContent,
    by_platform:         byPlatform,
  };
}
