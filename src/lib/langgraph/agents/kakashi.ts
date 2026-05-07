import { HumanMessage, AIMessage }   from '@langchain/core/messages';
import { createClient }               from '@supabase/supabase-js';
import { type KRGlobalStateType }     from '../state';
import { kakashiChain }               from '@/lib/langchain/chains/kakashi-chain';
import { scoreClient, scoreAllClients,
         getAtRiskClients }           from '@/lib/agents/kakashi/health-scorer';
import { sendCheckin, sendDueCheckins } from '@/lib/agents/kakashi/checkin-manager';
import { recordNps, getNpsSummary }   from '@/lib/agents/kakashi/nps-tracker';
import { detectChurnRisks,
         detectUpsellOpportunities,
         generateClientReport }       from '@/lib/agents/kakashi/churn-predictor';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

type KakashiAction =
  | 'score_all'
  | 'score_client'
  | 'get_at_risk'
  | 'send_checkin'
  | 'send_due_checkins'
  | 'record_nps'
  | 'nps_summary'
  | 'detect_churn'
  | 'detect_upsell'
  | 'client_report'
  | 'advice';

export async function kakashiNode(state: KRGlobalStateType): Promise<Partial<KRGlobalStateType>> {
  const action = (state.task_input['action'] as KakashiAction) ?? 'score_all';
  const input  = state.task_input;

  const userMsg = new HumanMessage(`KAKASHI action=${action} input=${JSON.stringify(input)}`);

  try {
    let result: Record<string, unknown>;

    switch (action) {

      case 'score_all': {
        const res  = await scoreAllClients();
        const narrative = await kakashiChain.invoke({
          context: '',
          input:   `${res.scored} clients scorés. ${res.at_risk.length} à risque : ${res.at_risk.map(c => `${c.client_name} (${c.score}/100)`).join(', ') || 'aucun'}. Donne un résumé et les actions prioritaires.`,
        });
        result = { ...res, narrative };
        break;
      }

      case 'score_client': {
        const clientId = input['client_id'] as string | undefined;
        if (!clientId) throw new Error('client_id requis');
        const health = await scoreClient(clientId);
        result = { health };
        break;
      }

      case 'get_at_risk': {
        const atRisk = await getAtRiskClients();
        result = { at_risk: atRisk, count: atRisk.length };
        break;
      }

      case 'send_checkin': {
        const clientId = input['client_id'] as string | undefined;
        if (!clientId) throw new Error('client_id requis');
        const res = await sendCheckin(clientId);
        result = { checkin: res };
        break;
      }

      case 'send_due_checkins': {
        const res = await sendDueCheckins();
        result = res;
        break;
      }

      case 'record_nps': {
        const clientId = input['client_id'] as string | undefined;
        const score    = input['score']     as number | undefined;
        if (!clientId || score === undefined) throw new Error('client_id et score requis');
        await recordNps({ client_id: clientId, score, comment: input['comment'] as string | undefined });
        result = { recorded: true, client_id: clientId, score };
        break;
      }

      case 'nps_summary': {
        const summary = await getNpsSummary();
        result = { nps: summary };
        break;
      }

      case 'detect_churn': {
        const risks = await detectChurnRisks();
        const narrative = await kakashiChain.invoke({
          context: '',
          input:   `Analyse ces risques de churn et priorise les actions :\n${JSON.stringify(risks, null, 2)}`,
        });
        result = { risks, count: risks.length, narrative };
        break;
      }

      case 'detect_upsell': {
        const opps = await detectUpsellOpportunities();
        result = { opportunities: opps, count: opps.length };
        break;
      }

      case 'client_report': {
        const clientId = input['client_id'] as string | undefined;
        if (!clientId) throw new Error('client_id requis');
        const report = await generateClientReport(clientId);
        result = { report };
        break;
      }

      case 'advice': {
        const question = (input['question'] as string | undefined) ?? 'Comment améliorer la rétention client ?';
        const advice   = await kakashiChain.invoke({ context: '', input: question });
        result = { advice };
        break;
      }

      default:
        throw new Error(`Action inconnue : ${action}`);
    }

    void supabase.from('alerts').insert({ agent_name: 'KAKASHI', level: 'INFO', message: `${action} OK` });

    return {
      agent_name:  'KAKASHI',
      status:      'completed',
      task_result: result,
      error:       null,
      messages:    [...state.messages, userMsg, new AIMessage(JSON.stringify(result))],
    };

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void supabase.from('alerts').insert({ agent_name: 'KAKASHI', level: 'WARNING', message });
    return {
      agent_name:  'KAKASHI',
      status:      'failed',
      error:       message,
      messages:    [...state.messages, userMsg],
    };
  }
}
