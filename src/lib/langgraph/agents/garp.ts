import { createClient }      from '@supabase/supabase-js';
import { calculateKPIs }     from '@/lib/agents/garp/kpi-calculator';
import { buildReport }       from '@/lib/agents/garp/report-builder';
import { sendReport, sendKpiAlert } from '@/lib/agents/garp/slack-reporter';
import type { KRGlobalStateType }   from '../state';
import type { KPIPeriod }           from '@/lib/agents/garp/kpi-calculator';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function log(level: string, message: string): Promise<void> {
  await supabase.from('alerts').insert({ agent_name: 'GARP', level, message });
}

export async function garpNode(state: KRGlobalStateType): Promise<Partial<KRGlobalStateType>> {
  const action = state.task_input['action'] as string;

  try {
    // ── generate_report ────────────────────────────────────────────────────────
    if (action === 'generate_report') {
      const period  = (state.task_input['period'] as KPIPeriod | undefined) ?? 'daily';
      const sendSlack = state.task_input['send_slack'] !== false;

      await log('INFO', `Génération rapport ${period} démarrée`);

      const kpis   = await calculateKPIs(period);
      const report = await buildReport(kpis, period);

      if (sendSlack) {
        await sendReport(report);
        await supabase
          .from('garp_reports')
          .update({ slack_sent: true })
          .eq('id', report.id ?? '');
      }

      // Alertes automatiques sur KPIs critiques
      if (kpis.marge_pct < 0) {
        await sendKpiAlert(`Marge nette NEGATIVE : ${kpis.marge_nette.toFixed(2)}€ (${kpis.marge_pct.toFixed(1)}%)`);
      }
      if (kpis.taux_succes < 80) {
        await sendKpiAlert(`Taux de succès agents bas : ${kpis.taux_succes.toFixed(1)}% (seuil : 80%)`);
      }

      await log('INFO', `Rapport ${period} généré — revenus=${kpis.revenus.toFixed(2)}€`);

      return {
        agent_name:  'GARP',
        status:      'completed',
        task_result: {
          report_id:   report.id,
          period,
          kpis,
          narrative:   report.narrative,
          slack_sent:  sendSlack,
        },
        error: null,
      };
    }

    // ── get_kpis ───────────────────────────────────────────────────────────────
    if (action === 'get_kpis') {
      const period = (state.task_input['period'] as KPIPeriod | undefined) ?? 'daily';
      const kpis   = await calculateKPIs(period);

      return {
        agent_name:  'GARP',
        status:      'completed',
        task_result: { kpis },
        error:       null,
      };
    }

    // ── send_alert ─────────────────────────────────────────────────────────────
    if (action === 'send_alert') {
      const message = state.task_input['message'] as string;
      if (!message) throw new Error('message requis pour send_alert');

      await sendKpiAlert(message);
      await log('INFO', `Alerte KPI envoyée : ${message}`);

      return {
        agent_name:  'GARP',
        status:      'completed',
        task_result: { sent: true },
        error:       null,
      };
    }

    // ── get_reports ────────────────────────────────────────────────────────────
    if (action === 'get_reports') {
      const period = state.task_input['period'] as KPIPeriod | undefined;
      const limit  = (state.task_input['limit'] as number | undefined) ?? 10;

      let query = supabase
        .from('garp_reports')
        .select('id, period, period_start, period_end, narrative, slack_sent, created_at')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (period) query = query.eq('period', period);

      const { data, error } = await query;
      if (error) throw new Error(error.message);

      return {
        agent_name:  'GARP',
        status:      'completed',
        task_result: { reports: data ?? [] },
        error:       null,
      };
    }

    throw new Error(`Action inconnue : ${action}`);

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await log('WARNING', `Erreur GARP action=${action} : ${message}`);

    return {
      agent_name: 'GARP',
      status:     'failed',
      error:      message,
    };
  }
}
