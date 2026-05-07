import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// Packages ranked by value — used to determine upgrade path
const PACKAGE_RANK: Record<string, number> = { starter: 1, growth: 2, enterprise: 3 };
const PACKAGE_PRICE: Record<string, number> = { starter: 1500, growth: 3000, enterprise: 6000 };
const UPGRADE_PATH: Record<string, string>  = { starter: 'growth', growth: 'enterprise' };

export interface UpsellCandidate {
  client_id:       string;
  client_name:     string;
  client_email:    string;
  current_package: string;
  target_package:  string;
  current_mrr:     number;
  target_mrr:      number;
  mrr_delta:       number;
  health_score:    number;
  nps_score:       number | null;
  reason:          string;
}

export async function detectOpportunities(): Promise<UpsellCandidate[]> {
  // Load clients with health scores ≥ 65 that aren't already Enterprise
  const { data: healthData, error: healthErr } = await supabase
    .from('client_health_scores')
    .select('client_id, score, nps_score, clients(name, email, product, amount_paid)')
    .gte('score', 65)
    .order('score', { ascending: false });
  if (healthErr) throw new Error(healthErr.message);

  // Load already-pitched opportunities in last 60 days to avoid spamming
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const { data: recentPitches } = await supabase
    .from('upsell_opportunities')
    .select('client_id')
    .in('status', ['pitched', 'interested', 'converted'])
    .gte('created_at', since);
  const recentIds = new Set((recentPitches ?? []).map(r => r['client_id'] as string));

  const candidates: UpsellCandidate[] = [];

  for (const row of healthData ?? []) {
    const clientId = row['client_id'] as string;
    if (recentIds.has(clientId)) continue;

    const client  = row['clients'] as unknown as Record<string, unknown>;
    const nps     = row['nps_score'] as number | null;
    if (nps !== null && nps < 7) continue; // Don't upsell detractors

    const product     = ((client?.['product'] as string | null) ?? 'starter').toLowerCase();
    const currentPkg  = PACKAGE_RANK[product] ? product : 'starter';
    const targetPkg   = UPGRADE_PATH[currentPkg];
    if (!targetPkg) continue; // Already Enterprise

    const currentMrr = PACKAGE_PRICE[currentPkg] ?? 1500;
    const targetMrr  = PACKAGE_PRICE[targetPkg]  ?? 3000;

    const score   = row['score'] as number;
    const reasons: string[] = [];
    if (score >= 85)          reasons.push(`score santé exceptionnel (${score}/100)`);
    else if (score >= 65)     reasons.push(`score santé solide (${score}/100)`);
    if (nps !== null && nps >= 9) reasons.push(`promoteur NPS (${nps}/10)`);
    if (currentPkg === 'starter') reasons.push('potentiel de croissance important');

    candidates.push({
      client_id:       clientId,
      client_name:     (client?.['name'] as string) ?? 'Inconnu',
      client_email:    (client?.['email'] as string) ?? '',
      current_package: currentPkg,
      target_package:  targetPkg,
      current_mrr:     currentMrr,
      target_mrr:      targetMrr,
      mrr_delta:       targetMrr - currentMrr,
      health_score:    score,
      nps_score:       nps,
      reason:          reasons.join(', '),
    });
  }

  return candidates;
}
