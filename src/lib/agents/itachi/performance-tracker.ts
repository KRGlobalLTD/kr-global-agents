import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ---- Types ----

export interface MetricsInput {
  contentId:    string;
  vues?:        number;
  clics?:       number;
  conversions?: number;
}

export interface AggregatedMetrics {
  content_id:      string;
  titre:           string | null;
  marque:          string;
  type:            string;
  vues:            number;
  clics:           number;
  conversions:     number;
  ctr:             number;   // clics / vues * 100
  taux_conversion: number;   // conversions / clics * 100
}

// Supabase joined query return shape
interface RawMetricRow {
  vues:        number;
  clics:       number;
  conversions: number;
}

interface RawContentWithMetrics {
  id:             string;
  titre:          string | null;
  marque:         string;
  type:           string;
  content_metrics: RawMetricRow[];
}

// ---- Aggregation helper ----

function aggregateMetrics(metrics: RawMetricRow[]): { vues: number; clics: number; conversions: number } {
  return metrics.reduce(
    (acc, m) => ({
      vues:        acc.vues        + m.vues,
      clics:       acc.clics       + m.clics,
      conversions: acc.conversions + m.conversions,
    }),
    { vues: 0, clics: 0, conversions: 0 }
  );
}

function buildAggregated(row: RawContentWithMetrics): AggregatedMetrics {
  const t = aggregateMetrics(row.content_metrics ?? []);
  return {
    content_id:      row.id,
    titre:           row.titre,
    marque:          row.marque,
    type:            row.type,
    vues:            t.vues,
    clics:           t.clics,
    conversions:     t.conversions,
    ctr:             t.vues  > 0 ? (t.clics       / t.vues)  * 100 : 0,
    taux_conversion: t.clics > 0 ? (t.conversions / t.clics) * 100 : 0,
  };
}

// ---- Track metrics ----

export async function trackMetrics(input: MetricsInput): Promise<void> {
  const { contentId, vues = 0, clics = 0, conversions = 0 } = input;

  // Vérifier que le contenu existe
  const { error: fetchError } = await supabase
    .from('content')
    .select('id')
    .eq('id', contentId)
    .single();

  if (fetchError) throw new Error(`Contenu introuvable : ${contentId}`);

  const { error } = await supabase.from('content_metrics').insert({
    content_id:  contentId,
    vues,
    clics,
    conversions,
    recorded_at: new Date().toISOString(),
  });

  if (error) throw new Error(`Erreur enregistrement métriques : ${error.message}`);

  await supabase.from('alerts').insert({
    agent_name: 'ITACHI',
    level:      'INFO',
    message:    `Métriques enregistrées : content_id=${contentId}, vues=${vues}, clics=${clics}, conversions=${conversions}`,
  });
}

// ---- Get metrics for one content piece ----

export async function getContentMetrics(contentId: string): Promise<AggregatedMetrics | null> {
  const { data, error } = await supabase
    .from('content')
    .select('id, titre, marque, type, content_metrics(vues, clics, conversions)')
    .eq('id', contentId)
    .single();

  if (error || !data) return null;

  return buildAggregated(data as unknown as RawContentWithMetrics);
}

// ---- Weekly report ----

export async function generateWeeklyReport(): Promise<void> {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();

  const { data, error } = await supabase
    .from('content')
    .select('id, titre, marque, type, content_metrics(vues, clics, conversions)')
    .eq('statut', 'publie')
    .gte('published_at', since);

  if (error) throw new Error(`Erreur rapport hebdo : ${error.message}`);

  const rows = (data ?? []) as unknown as RawContentWithMetrics[];
  const aggregated = rows.map(buildAggregated);

  const totalVues        = aggregated.reduce((s, r) => s + r.vues, 0);
  const totalClics       = aggregated.reduce((s, r) => s + r.clics, 0);
  const totalConversions = aggregated.reduce((s, r) => s + r.conversions, 0);
  const globalCtr        = totalVues > 0 ? ((totalClics / totalVues) * 100).toFixed(1) : '0';

  const top3 = [...aggregated].sort((a, b) => b.vues - a.vues).slice(0, 3);

  const lines: string[] = [
    `📊 *Rapport hebdomadaire ITACHI*`,
    `Période : 7 derniers jours | ${rows.length} contenu(s) publié(s)`,
    ``,
    `*Totaux :*`,
    `• Vues : ${totalVues.toLocaleString('fr-FR')}`,
    `• Clics : ${totalClics.toLocaleString('fr-FR')} (CTR global : ${globalCtr}%)`,
    `• Conversions : ${totalConversions}`,
    ``,
    top3.length > 0
      ? `*Top ${top3.length} contenus (vues) :*`
      : `Aucun contenu publié cette semaine.`,
    ...top3.map((r, i) =>
      `${i + 1}. ${r.titre ?? r.content_id} — ${r.vues} vues, ${r.clics} clics, ${r.conversions} conv.`
    ),
  ];

  const webhookUrl = process.env.SLACK_WEBHOOK_GENERAL;
  if (webhookUrl) {
    const slackRes = await fetch(webhookUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text:        lines.join('\n'),
        username:    'ITACHI',
        icon_emoji:  ':bar_chart:',
      }),
    });

    if (!slackRes.ok) {
      await supabase.from('alerts').insert({
        agent_name: 'ITACHI',
        level:      'WARNING',
        message:    `Slack #general webhook échoué (rapport hebdo) : ${slackRes.status}`,
      });
    }
  }

  await supabase.from('alerts').insert({
    agent_name: 'ITACHI',
    level:      'INFO',
    message:    `Rapport hebdo envoyé : ${rows.length} contenus, ${totalVues} vues, ${totalConversions} conversions`,
  });
}
