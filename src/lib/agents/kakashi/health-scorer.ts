import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export interface ClientHealth {
  client_id:          string;
  client_name:        string;
  client_email:       string;
  score:              number;
  risk_level:         'low' | 'medium' | 'high' | 'critical';
  trend:              'improving' | 'stable' | 'declining';
  factors:            Record<string, number>;
  next_checkin_date:  string;
  nps_score:          number | null;
}

function riskLevel(score: number): 'low' | 'medium' | 'high' | 'critical' {
  if (score >= 70) return 'low';
  if (score >= 45) return 'medium';
  if (score >= 25) return 'high';
  return 'critical';
}

function nextCheckinDate(risk: string): string {
  const days = risk === 'low' ? 30 : risk === 'medium' ? 14 : 7;
  return new Date(Date.now() + days * 86_400_000).toISOString().split('T')[0];
}

export async function scoreClient(clientId: string): Promise<ClientHealth> {
  const [clientRes, invoicesRes, ticketsRes, existingRes] = await Promise.all([
    supabase.from('clients').select('id, name, email, company, onboarded_at, amount_paid').eq('id', clientId).single(),
    supabase.from('invoices').select('status, due_date, created_at').eq('client_id', clientId).order('created_at', { ascending: false }).limit(10),
    supabase.from('tickets').select('status, created_at').eq('client_id', clientId).order('created_at', { ascending: false }).limit(20),
    supabase.from('client_health_scores').select('score, nps_score, trend').eq('client_id', clientId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ]);

  if (clientRes.error || !clientRes.data) throw new Error(`Client ${clientId} introuvable`);
  const client   = clientRes.data;
  const invoices = invoicesRes.data ?? [];
  const tickets  = ticketsRes.data ?? [];
  const prev     = existingRes.data;

  // Factor 1 — Payment behavior (0-30 pts)
  const totalInvoices = invoices.length;
  const overdueCount  = invoices.filter(i =>
    i['status'] !== 'paid' && i['due_date'] && new Date(i['due_date'] as string) < new Date(),
  ).length;
  const paymentScore = totalInvoices === 0
    ? 20
    : Math.max(0, 30 - overdueCount * 15);

  // Factor 2 — Support load (0-25 pts): fewer open tickets = higher score
  const openTickets   = tickets.filter(t => t['status'] === 'open').length;
  const supportScore  = Math.max(0, 25 - openTickets * 8);

  // Factor 3 — Tenure (0-20 pts): clients who stay > 90 days are stable
  const tenureDays   = Math.floor((Date.now() - new Date(client['onboarded_at'] as string).getTime()) / 86_400_000);
  const tenureScore  = Math.min(20, Math.floor(tenureDays / 10));

  // Factor 4 — NPS bonus (0-15 pts)
  const npsRaw   = existingRes.data?.['nps_score'] as number | null ?? null;
  const npsScore = npsRaw !== null ? Math.round((npsRaw / 10) * 15) : 8;

  // Factor 5 — Activity recency (0-10 pts): recent invoice = active client
  const lastInvoiceDate = invoices[0]?.['created_at'] ? new Date(invoices[0]['created_at'] as string) : null;
  const daysSinceInvoice = lastInvoiceDate
    ? Math.floor((Date.now() - lastInvoiceDate.getTime()) / 86_400_000)
    : 999;
  const activityScore = daysSinceInvoice < 35 ? 10 : daysSinceInvoice < 70 ? 5 : 0;

  const total  = paymentScore + supportScore + tenureScore + npsScore + activityScore;
  const score  = Math.min(100, Math.max(0, total));
  const risk   = riskLevel(score);
  const trend: 'improving' | 'stable' | 'declining' = prev
    ? (score > (prev['score'] as number) + 5 ? 'improving' : score < (prev['score'] as number) - 5 ? 'declining' : 'stable')
    : 'stable';

  const factors = { payment: paymentScore, support: supportScore, tenure: tenureScore, nps: npsScore, activity: activityScore };

  await supabase.from('client_health_scores').upsert(
    {
      client_id:         clientId,
      score,
      risk_level:        risk,
      trend,
      factors,
      next_checkin_date: nextCheckinDate(risk),
      nps_score:         npsRaw,
      updated_at:        new Date().toISOString(),
    },
    { onConflict: 'client_id' },
  );

  return {
    client_id:         clientId,
    client_name:       client['name'] as string,
    client_email:      client['email'] as string,
    score,
    risk_level:        risk,
    trend,
    factors,
    next_checkin_date: nextCheckinDate(risk),
    nps_score:         npsRaw,
  };
}

export async function scoreAllClients(): Promise<{ scored: number; at_risk: ClientHealth[] }> {
  const { data: clients, error } = await supabase
    .from('clients')
    .select('id')
    .eq('status', 'ACTIVE');
  if (error) throw new Error(error.message);

  const results: ClientHealth[] = [];
  for (const c of clients ?? []) {
    try {
      const h = await scoreClient(c['id'] as string);
      results.push(h);
    } catch { /* skip failed */ }
  }

  const atRisk = results.filter(r => r.risk_level === 'high' || r.risk_level === 'critical');
  if (atRisk.length > 0) {
    const msg = atRisk.map(r => `• ${r.client_name} — score ${r.score} (${r.risk_level})`).join('\n');
    void fetch(process.env.SLACK_WEBHOOK_ALERTES!, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text: `⚠️ KAKASHI — ${atRisk.length} client(s) à risque :\n${msg}` }),
    });
  }

  return { scored: results.length, at_risk: atRisk };
}

export async function getAtRiskClients(): Promise<ClientHealth[]> {
  const { data, error } = await supabase
    .from('client_health_scores')
    .select('*, clients(name, email)')
    .in('risk_level', ['high', 'critical'])
    .order('score', { ascending: true });
  if (error) throw new Error(error.message);

  return (data ?? []).map(r => ({
    client_id:         r['client_id'] as string,
    client_name:       (r['clients'] as Record<string, unknown>)?.['name'] as string ?? 'Inconnu',
    client_email:      (r['clients'] as Record<string, unknown>)?.['email'] as string ?? '',
    score:             r['score'] as number,
    risk_level:        r['risk_level'] as 'low' | 'medium' | 'high' | 'critical',
    trend:             r['trend'] as 'improving' | 'stable' | 'declining',
    factors:           r['factors'] as Record<string, number>,
    next_checkin_date: r['next_checkin_date'] as string,
    nps_score:         r['nps_score'] as number | null,
  }));
}
