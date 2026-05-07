import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export interface RevenueScenario {
  month:          string;
  conservative:   number;
  realistic:      number;
  optimistic:     number;
}

export interface ForecastReport {
  current_mrr_gbp:       number;
  target_mrr_gbp:        number;
  months_to_target:      number;
  scenarios:             RevenueScenario[];
  key_drivers:           string[];
  risks:                 string[];
}

export async function forecastRevenue(months = 12): Promise<ForecastReport> {
  const [wlClients, activeClients, prospects, partners] = await Promise.all([
    supabase.from('whitelabel_clients').select('mrr_gbp').eq('status', 'active'),
    supabase.from('clients').select('id', { count: 'exact', head: true }).eq('status', 'ACTIVE'),
    supabase.from('prospects').select('status'),
    supabase.from('partners').select('status, referred_clients'),
  ]);

  const currentMrr = (wlClients.data ?? [])
    .reduce((s, c) => s + ((c['mrr_gbp'] as number) ?? 0), 0);

  const totalClients   = activeClients.count ?? 0;
  const hotProspects   = (prospects.data ?? []).filter(p => p['status'] === 'CHAUD').length;
  const coldProspects  = (prospects.data ?? []).filter(p => p['status'] === 'FROID').length;
  const activePartners = (partners.data ?? []).filter(p => p['status'] === 'active').length;

  // Growth assumptions
  const conservativeMonthlyGrowth = 300;  // £300/month new MRR (conservative)
  const realisticMonthlyGrowth    = 600;  // £600/month (1 new client/month avg)
  const optimisticMonthlyGrowth   = 1200; // £1200/month (2 clients + partner referrals)

  const scenarios: RevenueScenario[] = [];
  let consMrr = currentMrr;
  let realMrr = currentMrr;
  let optiMrr = currentMrr;

  let monthsToTarget = -1;

  for (let i = 1; i <= months; i++) {
    consMrr += conservativeMonthlyGrowth;
    realMrr += realisticMonthlyGrowth;
    optiMrr += optimisticMonthlyGrowth;

    if (monthsToTarget === -1 && realMrr >= 5000) {
      monthsToTarget = i;
    }

    const d = new Date();
    d.setMonth(d.getMonth() + i);
    scenarios.push({
      month:        d.toISOString().slice(0, 7),
      conservative: Math.round(consMrr),
      realistic:    Math.round(realMrr),
      optimistic:   Math.round(optiMrr),
    });
  }

  const keyDrivers: string[] = [
    `${hotProspects} prospects chauds en pipeline (valeur ~£${hotProspects * 2000})`,
    `${coldProspects} prospects froids à qualifier (conversion estimée 5%)`,
    `${activePartners} partenaires actifs (potentiel +£${activePartners * 450}/mois)`,
    `Programme white label : base MRR £${Math.round(currentMrr)}`,
    `${totalClients} clients actifs — opportunités upsell via JIRAIYA`,
  ];

  const risks = [
    'Churn clients si onboarding insuffisant (KAKASHI)',
    'Dépendance Apollo.io pour prospection (diversifier sources)',
    'Tokens LinkedIn/Instagram expirés (SANJI bloqué)',
    'Pas encore de revenus directs enregistrés (transactions = 0 actuellement)',
  ];

  return {
    current_mrr_gbp:  Math.round(currentMrr * 100) / 100,
    target_mrr_gbp:   5000,
    months_to_target: monthsToTarget === -1 ? months + 1 : monthsToTarget,
    scenarios,
    key_drivers:      keyDrivers,
    risks,
  };
}
