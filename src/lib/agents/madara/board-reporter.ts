import { createClient }          from '@supabase/supabase-js';
import { madaraChain }            from '@/lib/langchain/chains/madara-chain';
import type { ExecutiveKPIs }     from './executive-dashboard';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function generateBoardReport(kpis: ExecutiveKPIs): Promise<{
  narrative: string;
  html:      string;
  report_id: string;
}> {
  const narrative = await madaraChain.invoke({
    context: '',
    input: `Génère un rapport exécutif mensuel basé sur ces KPIs :
MRR actuel : £${kpis.mrr_gbp} (objectif 5k : £${kpis.target_5k_gap_gbp} restants)
Revenus MTD : £${kpis.revenue_mtd_gbp} | YTD : £${kpis.revenue_ytd_gbp}
Clients actifs : ${kpis.active_clients} (+${kpis.new_clients_mtd} ce mois)
Prospects : ${kpis.prospects_total} total, ${kpis.prospects_hot} chauds, pipeline £${kpis.pipeline_value_gbp}
Contenu : ${kpis.content_published_mtd} publiés, ${kpis.content_pending} en attente
Partenaires actifs : ${kpis.active_partners} | White Label MRR : £${kpis.wl_mrr_gbp}
Campagnes : ${kpis.active_campaigns} actives, ${kpis.emails_sent_mtd} emails, reply rate ${kpis.reply_rate_pct}%
Agents : ${kpis.agents_healthy}/${kpis.agents_total} sains, ${kpis.alerts_24h} alertes (24h)

Inclure : résumé 3 lignes, top 3 actions prioritaires, risques identifiés, prévision mois prochain.`,
  });

  const html = `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><title>KR Global — Rapport Exécutif ${kpis.period}</title>
<style>body{font-family:Arial,sans-serif;max-width:800px;margin:0 auto;padding:20px;color:#1a1a1a}
h1{color:#0066cc;border-bottom:2px solid #0066cc;padding-bottom:8px}
.kpi-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:20px 0}
.kpi{background:#f0f4ff;border-radius:8px;padding:12px;text-align:center}
.kpi-value{font-size:24px;font-weight:bold;color:#0066cc}
.kpi-label{font-size:12px;color:#666;margin-top:4px}
.target{background:#fff3cd;border-left:4px solid #ffc107;padding:12px;margin:16px 0;border-radius:4px}
.narrative{background:#f8f9fa;border-radius:8px;padding:16px;white-space:pre-wrap;line-height:1.6}
</style></head>
<body>
<h1>🎯 KR Global — Rapport Exécutif ${kpis.period}</h1>
<div class="target"><strong>Objectif Phase 5 :</strong> £5 000/mois MRR —
  <strong style="color:${kpis.target_5k_gap_gbp === 0 ? '#28a745' : '#dc3545'}">
    ${kpis.target_5k_gap_gbp === 0 ? '✅ ATTEINT' : `£${kpis.target_5k_gap_gbp} restants`}
  </strong>
</div>
<div class="kpi-grid">
  <div class="kpi"><div class="kpi-value">£${kpis.mrr_gbp}</div><div class="kpi-label">MRR</div></div>
  <div class="kpi"><div class="kpi-value">£${kpis.revenue_mtd_gbp}</div><div class="kpi-label">Revenus MTD</div></div>
  <div class="kpi"><div class="kpi-value">${kpis.active_clients}</div><div class="kpi-label">Clients actifs</div></div>
  <div class="kpi"><div class="kpi-value">${kpis.prospects_hot}</div><div class="kpi-label">Prospects chauds</div></div>
  <div class="kpi"><div class="kpi-value">£${kpis.pipeline_value_gbp}</div><div class="kpi-label">Pipeline</div></div>
  <div class="kpi"><div class="kpi-value">${kpis.reply_rate_pct}%</div><div class="kpi-label">Reply rate</div></div>
  <div class="kpi"><div class="kpi-value">${kpis.active_partners}</div><div class="kpi-label">Partenaires</div></div>
  <div class="kpi"><div class="kpi-value">£${kpis.wl_mrr_gbp}</div><div class="kpi-label">White Label MRR</div></div>
  <div class="kpi"><div class="kpi-value">${kpis.agents_healthy}/${kpis.agents_total}</div><div class="kpi-label">Agents sains</div></div>
</div>
<h2>Analyse exécutive</h2>
<div class="narrative">${narrative}</div>
<p style="color:#999;font-size:12px;margin-top:24px">Généré le ${new Date().toLocaleDateString('fr-FR')} par MADARA — KR Global AI System</p>
</body></html>`;

  const { data } = await supabase
    .from('executive_reports')
    .insert({ period: kpis.period, type: 'monthly', kpis, narrative })
    .select('id')
    .single();

  void supabase.from('alerts').insert({
    agent_name: 'MADARA',
    level:      'INFO',
    message:    `Rapport exécutif généré — ${kpis.period} — MRR £${kpis.mrr_gbp}`,
  });

  return { narrative, html, report_id: (data?.['id'] as string) ?? '' };
}

export async function getReportHistory(limit = 12): Promise<Record<string, unknown>[]> {
  const { data } = await supabase
    .from('executive_reports')
    .select('id, period, type, kpis, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  return data ?? [];
}
