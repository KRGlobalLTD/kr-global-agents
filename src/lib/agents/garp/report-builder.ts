import { createClient } from '@supabase/supabase-js';
import { garpChain }   from '@/lib/langchain/chains/garp-chain';
import type { KPIs, KPIPeriod } from './kpi-calculator';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface GarpReport {
  id?:          string;
  period:       KPIPeriod;
  period_start: string;
  period_end:   string;
  kpis:         KPIs;
  narrative:    string;
  slack_blocks: object;
  created_at?:  string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function eur(n: number): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);
}

function delta(cur: number, prev: number): string {
  if (prev === 0) return cur > 0 ? '+∞' : '0%';
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  return (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%';
}

const PERIOD_LABELS: Record<KPIPeriod, string> = {
  daily:   'Quotidien',
  weekly:  'Hebdomadaire',
  monthly: 'Mensuel',
};

// ── Narrative via LangChain ────────────────────────────────────────────────────

async function buildNarrative(kpis: KPIs): Promise<string> {
  const prompt =
    `Analyse ces KPIs de KR Global Solutions Ltd et rédige un résumé exécutif de 3-4 phrases.\n\n` +
    `Période : ${kpis.period}\n` +
    `Revenus : ${eur(kpis.revenus)} (vs ${eur(kpis.revenus_prev)} période précédente)\n` +
    `Dépenses : ${eur(kpis.depenses)} | Marge nette : ${eur(kpis.marge_nette)} (${kpis.marge_pct.toFixed(1)}%)\n` +
    `Coûts IA : ${eur(kpis.cout_ia)}\n` +
    `Nouveaux clients : ${kpis.nouveaux_clients} (vs ${kpis.clients_prev})\n` +
    `Tâches agents : ${kpis.taches_executees} | Taux de succès : ${kpis.taux_succes.toFixed(1)}%\n\n` +
    `Identifie les points positifs, les risques et recommande 1 action prioritaire concrète.`;

  try {
    return await garpChain.invoke({ input: prompt });
  } catch {
    return (
      `Rapport ${kpis.period} : revenus ${eur(kpis.revenus)}, ` +
      `marge ${kpis.marge_pct.toFixed(1)}%, ` +
      `${kpis.taches_executees} tâches agents (${kpis.taux_succes.toFixed(1)}% succès).`
    );
  }
}

// ── Slack blocks builder ───────────────────────────────────────────────────────

function buildSlackBlocks(kpis: KPIs, narrative: string): object {
  const label = PERIOD_LABELS[kpis.period];
  const date  = new Date(kpis.period_start).toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  const revEmoji     = kpis.revenus >= kpis.revenus_prev ? '📈' : '📉';
  const successEmoji = kpis.taux_succes >= 95 ? '🟢' : kpis.taux_succes >= 80 ? '🟡' : '🔴';
  const margeEmoji   = kpis.marge_nette >= 0 ? '✅' : '🚨';

  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: `📊 Rapport ${label} — KR Global Solutions Ltd`, emoji: true },
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `*Période :* ${date}` }],
    },
    { type: 'divider' },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `${revEmoji} *Revenus*\n${eur(kpis.revenus)} _(${delta(kpis.revenus, kpis.revenus_prev)})_` },
        { type: 'mrkdwn', text: `💸 *Dépenses*\n${eur(kpis.depenses)} _(${delta(kpis.depenses, kpis.depenses_prev)})_` },
        { type: 'mrkdwn', text: `${margeEmoji} *Marge nette*\n${eur(kpis.marge_nette)} _(${kpis.marge_pct.toFixed(1)}%)_` },
        { type: 'mrkdwn', text: `🤖 *Coûts IA*\n${eur(kpis.cout_ia)}` },
      ],
    },
    { type: 'divider' },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `👤 *Nouveaux clients*\n${kpis.nouveaux_clients} _(${delta(kpis.nouveaux_clients, kpis.clients_prev)})_` },
        { type: 'mrkdwn', text: `⚡ *Tâches agents*\n${kpis.taches_executees} _(${delta(kpis.taches_executees, kpis.taches_prev)})_` },
        { type: 'mrkdwn', text: `${successEmoji} *Taux de succès*\n${kpis.taux_succes.toFixed(1)}%` },
      ],
    },
    { type: 'divider' },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Analyse GARP :*\n${narrative}` },
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `_Généré automatiquement par GARP — ${new Date().toLocaleString('fr-FR')}_` }],
    },
  ];
}

// ── Main export ────────────────────────────────────────────────────────────────

export async function buildReport(kpis: KPIs, period: KPIPeriod): Promise<GarpReport> {
  const [narrative] = await Promise.all([buildNarrative(kpis)]);
  const slack_blocks = buildSlackBlocks(kpis, narrative);

  const { data, error } = await supabase
    .from('garp_reports')
    .insert({
      period:       kpis.period,
      period_start: kpis.period_start,
      period_end:   kpis.period_end,
      kpis,
      narrative,
      slack_sent:   false,
    })
    .select('id, created_at')
    .single();

  if (error) {
    await supabase.from('alerts').insert({
      agent_name: 'GARP',
      level:      'WARNING',
      message:    `Erreur sauvegarde rapport ${period} : ${error.message}`,
    });
  }

  const row = (data ?? {}) as { id?: string; created_at?: string };

  return {
    id:          row.id,
    period,
    period_start: kpis.period_start,
    period_end:   kpis.period_end,
    kpis,
    narrative,
    slack_blocks,
    created_at:  row.created_at,
  };
}
