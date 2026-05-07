import { HumanMessage, AIMessage }   from '@langchain/core/messages';
import { createClient }               from '@supabase/supabase-js';
import { type KRGlobalStateType }     from '../state';
import { madaraChain }                from '@/lib/langchain/chains/madara-chain';
import { buildExecutiveDashboard }    from '@/lib/agents/madara/executive-dashboard';
import { exportXeroInvoices,
         exportQuickBooksIIF,
         exportOdooJSON }             from '@/lib/agents/madara/erp-exporter';
import { generateBoardReport,
         getReportHistory }           from '@/lib/agents/madara/board-reporter';
import { forecastRevenue }            from '@/lib/agents/madara/forecaster';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

type MadaraAction =
  | 'get_dashboard'
  | 'generate_report'
  | 'get_history'
  | 'export_xero'
  | 'export_quickbooks'
  | 'export_odoo'
  | 'forecast'
  | 'advice';

export async function madaraNode(state: KRGlobalStateType): Promise<Partial<KRGlobalStateType>> {
  const action = (state.task_input['action'] as MadaraAction) ?? 'get_dashboard';
  const input  = state.task_input;

  const userMsg = new HumanMessage(`MADARA action=${action} input=${JSON.stringify(input)}`);

  try {
    let result: Record<string, unknown>;

    switch (action) {

      case 'get_dashboard': {
        const kpis = await buildExecutiveDashboard(input['period'] as string | undefined);
        result = { kpis };
        break;
      }

      case 'generate_report': {
        const kpis   = await buildExecutiveDashboard(input['period'] as string | undefined);
        const report = await generateBoardReport(kpis);
        void fetch(process.env.SLACK_WEBHOOK!, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            text: `📊 MADARA — Rapport exécutif ${kpis.period}\nMRR : £${kpis.mrr_gbp} | Pipeline : £${kpis.pipeline_value_gbp} | Objectif 5k : £${kpis.target_5k_gap_gbp} restants`,
          }),
        });
        result = { report_id: report.report_id, kpis, narrative: report.narrative };
        break;
      }

      case 'get_history': {
        const limit   = (input['limit'] as number) ?? 12;
        const reports = await getReportHistory(limit);
        result = { reports, count: reports.length };
        break;
      }

      case 'export_xero': {
        const csv  = await exportXeroInvoices(input['month'] as string | undefined);
        result = { format: 'xero_csv', rows: csv.split('\n').length - 2, csv };
        break;
      }

      case 'export_quickbooks': {
        const iif  = await exportQuickBooksIIF(input['month'] as string | undefined);
        result = { format: 'quickbooks_iif', iif };
        break;
      }

      case 'export_odoo': {
        const records = await exportOdooJSON(input['month'] as string | undefined);
        result = { format: 'odoo_json', records, count: records.length };
        break;
      }

      case 'forecast': {
        const months   = (input['months'] as number) ?? 12;
        const forecast = await forecastRevenue(months);
        result = { forecast };
        break;
      }

      case 'advice': {
        const question = (input['question'] as string | undefined) ?? "Quelle est notre trajectoire vers 5 000£/mois ?";
        const advice   = await madaraChain.invoke({ context: '', input: question });
        result = { advice };
        break;
      }

      default:
        throw new Error(`Action inconnue : ${action}`);
    }

    void supabase.from('alerts').insert({ agent_name: 'MADARA', level: 'INFO', message: `${action} OK` });

    return {
      agent_name:  'MADARA',
      status:      'completed',
      task_result: result,
      error:       null,
      messages:    [...state.messages, userMsg, new AIMessage(JSON.stringify(result))],
    };

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void supabase.from('alerts').insert({ agent_name: 'MADARA', level: 'WARNING', message });
    return {
      agent_name: 'MADARA',
      status:     'failed',
      error:      message,
      messages:   [...state.messages, userMsg],
    };
  }
}
