import { createClient } from '@supabase/supabase-js';
import type { Period } from './content-analytics';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export interface FunnelStage {
  name:       string;
  count:      number;
  conversion: number;   // % depuis l'étape précédente
}

export interface ConversionFunnel {
  period:              Period;
  stages:              FunnelStage[];
  overall_conversion:  number;   // leads → clients (%)
  avg_deal_value:      number;
  total_revenue:       number;
  lost_at_cold:        number;
  lost_at_hot:         number;
}

function periodToDate(period: Period): Date {
  const now = new Date();
  switch (period) {
    case 'week':    return new Date(now.getTime() - 7  * 24 * 60 * 60 * 1000);
    case 'month':   return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case 'quarter': return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  }
}

function pct(n: number, total: number): number {
  return total > 0 ? Math.round((n / total) * 10000) / 100 : 0;
}

export async function analyzeConversionFunnel(period: Period = 'month'): Promise<ConversionFunnel> {
  const since = periodToDate(period).toISOString();
  const now   = new Date().toISOString();

  const [prospectsRes, clientsRes, txRes] = await Promise.allSettled([
    supabase
      .from('prospects')
      .select('classification, response_sent_at')
      .gte('created_at', since),
    supabase
      .from('clients')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', since),
    supabase
      .from('transactions')
      .select('amount')
      .gte('date', since.slice(0, 10))
      .lt('date', now.slice(0, 10))
      .in('category', ['REVENU_STRIPE', 'REVENU_GUMROAD', 'REVENU_AUTRE']),
  ]);

  const prospects    = prospectsRes.status === 'fulfilled' ? (prospectsRes.value.data ?? []) : [];
  const clientsCount = clientsRes.status  === 'fulfilled' ? (clientsRes.value.count  ?? 0)  : 0;
  const txData       = txRes.status       === 'fulfilled' ? (txRes.value.data        ?? [])  : [];

  const totalProspects = prospects.length;
  const hotProspects   = prospects.filter(p => p.classification === 'prospect_chaud').length;
  const coldProspects  = prospects.filter(p => p.classification === 'prospect_froid').length;
  const responded      = prospects.filter(p => (p.response_sent_at as string | null)).length;
  const clients        = clientsCount;

  const totalRevenue = txData.reduce((s, t) => s + ((t.amount as number) ?? 0), 0);
  const avgDealValue = clients > 0 ? Math.round((totalRevenue / clients) * 100) / 100 : 0;

  const stages: FunnelStage[] = [
    { name: 'Emails entrants',    count: totalProspects, conversion: 100 },
    { name: 'Prospects chauds',   count: hotProspects,   conversion: pct(hotProspects, totalProspects) },
    { name: 'Réponses envoyées',  count: responded,      conversion: pct(responded, hotProspects) },
    { name: 'Clients onboardés',  count: clients,        conversion: pct(clients, responded) },
  ];

  return {
    period,
    stages,
    overall_conversion:  pct(clients, totalProspects),
    avg_deal_value:      avgDealValue,
    total_revenue:       Math.round(totalRevenue * 100) / 100,
    lost_at_cold:        coldProspects,
    lost_at_hot:         Math.max(0, hotProspects - responded),
  };
}
