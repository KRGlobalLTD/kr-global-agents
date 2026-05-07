import { createClient } from '@supabase/supabase-js';
import type { Period } from './content-analytics';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export interface GrowthMetric {
  metric:    string;
  current:   number;
  previous:  number;
  delta:     number;
  delta_pct: number;
  trend:     'up' | 'down' | 'flat';
}

export interface GrowthReport {
  period:       Period;
  metrics:      GrowthMetric[];
  highlights:   string[];
  alerts:       string[];
  generated_at: string;
}

function periodMs(period: Period): number {
  switch (period) {
    case 'week':    return 7  * 24 * 60 * 60 * 1000;
    case 'month':   return 30 * 24 * 60 * 60 * 1000;
    case 'quarter': return 90 * 24 * 60 * 60 * 1000;
  }
}

function buildMetric(metric: string, current: number, previous: number): GrowthMetric {
  const delta     = Math.round((current - previous) * 100) / 100;
  const delta_pct = previous > 0 ? Math.round((delta / previous) * 10000) / 100 : 0;
  const trend     = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  return { metric, current, previous, delta, delta_pct, trend };
}

async function countRows(
  table:     string,
  dateField: string,
  from:      string,
  to:        string,
  eq:        Record<string, string> = {},
): Promise<number> {
  let q = supabase
    .from(table)
    .select('*', { count: 'exact', head: true })
    .gte(dateField, from)
    .lt(dateField, to);

  for (const [k, v] of Object.entries(eq)) q = q.eq(k, v);

  const { count, error } = await q;
  return error ? 0 : (count ?? 0);
}

async function sumRevenue(from: string, to: string): Promise<number> {
  const { data, error } = await supabase
    .from('transactions')
    .select('amount')
    .gte('date', from.slice(0, 10))
    .lt('date', to.slice(0, 10))
    .in('category', ['REVENU_STRIPE', 'REVENU_GUMROAD', 'REVENU_AUTRE']);

  if (error) return 0;
  return (data ?? []).reduce((s, r) => s + ((r.amount as number) ?? 0), 0);
}

export async function trackGrowth(period: Period = 'month'): Promise<GrowthReport> {
  const now      = new Date();
  const ms       = periodMs(period);
  const curStart = new Date(now.getTime() - ms).toISOString();
  const prevStart= new Date(now.getTime() - ms * 2).toISOString();
  const nowIso   = now.toISOString();

  const [
    curRevenue,  prevRevenue,
    curClients,  prevClients,
    curProspects,prevProspects,
    curHot,      prevHot,
    curContent,  prevContent,
    curCampaigns,prevCampaigns,
  ] = await Promise.all([
    sumRevenue(curStart,  nowIso),
    sumRevenue(prevStart, curStart),
    countRows('clients',   'created_at', curStart,  nowIso,   {}),
    countRows('clients',   'created_at', prevStart, curStart, {}),
    countRows('prospects', 'created_at', curStart,  nowIso,   {}),
    countRows('prospects', 'created_at', prevStart, curStart, {}),
    countRows('prospects', 'created_at', curStart,  nowIso,   { classification: 'prospect_chaud' }),
    countRows('prospects', 'created_at', prevStart, curStart, { classification: 'prospect_chaud' }),
    countRows('content',   'created_at', curStart,  nowIso,   { statut: 'publié' }),
    countRows('content',   'created_at', prevStart, curStart, { statut: 'publié' }),
    countRows('campaigns', 'created_at', curStart,  nowIso,   {}),
    countRows('campaigns', 'created_at', prevStart, curStart, {}),
  ]);

  const metrics: GrowthMetric[] = [
    buildMetric('Revenus (€)',        Math.round(curRevenue  * 100) / 100, Math.round(prevRevenue  * 100) / 100),
    buildMetric('Nouveaux clients',   curClients,   prevClients),
    buildMetric('Prospects totaux',   curProspects, prevProspects),
    buildMetric('Prospects chauds',   curHot,       prevHot),
    buildMetric('Contenus publiés',   curContent,   prevContent),
    buildMetric('Campagnes actives',  curCampaigns, prevCampaigns),
  ];

  const highlights: string[] = [];
  const alerts:     string[] = [];

  for (const m of metrics) {
    if (m.trend === 'up'   && m.delta_pct >= 20) highlights.push(`📈 ${m.metric} +${m.delta_pct}% (${m.previous} → ${m.current})`);
    if (m.trend === 'down' && Math.abs(m.delta_pct) >= 15) alerts.push(`📉 ${m.metric} -${Math.abs(m.delta_pct)}% (${m.previous} → ${m.current})`);
  }

  await supabase.from('alerts').insert({
    agent_name: 'NEJI',
    level:      alerts.length > 0 ? 'WARNING' : 'INFO',
    message:    `Growth ${period} — revenus=${curRevenue.toFixed(2)}€, clients=${curClients}, prospects_chauds=${curHot}`,
  });

  return {
    period,
    metrics,
    highlights,
    alerts,
    generated_at: nowIso,
  };
}
