import { HumanMessage, AIMessage }      from '@langchain/core/messages';
import { createClient }                  from '@supabase/supabase-js';
import { type KRGlobalStateType }        from '../state';
import { jiraiyaChain }                  from '@/lib/langchain/chains/jiraiya-chain';
import { detectOpportunities }           from '@/lib/agents/jiraiya/opportunity-detector';
import { generatePitch }                 from '@/lib/agents/jiraiya/pitch-generator';
import { runCampaign, sendPitch }        from '@/lib/agents/jiraiya/campaign-runner';
import { markConverted, markInterested,
         getOpportunities, getMrrImpact } from '@/lib/agents/jiraiya/conversion-tracker';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

type JiraiyaAction =
  | 'detect_opportunities'
  | 'generate_pitch'
  | 'run_campaign'
  | 'mark_converted'
  | 'mark_interested'
  | 'get_opportunities'
  | 'mrr_impact'
  | 'advice';

export async function jiraiyaNode(state: KRGlobalStateType): Promise<Partial<KRGlobalStateType>> {
  const action = (state.task_input['action'] as JiraiyaAction) ?? 'detect_opportunities';
  const input  = state.task_input;

  const userMsg = new HumanMessage(`JIRAIYA action=${action} input=${JSON.stringify(input)}`);

  try {
    let result: Record<string, unknown>;

    switch (action) {

      case 'detect_opportunities': {
        const candidates = await detectOpportunities();
        const narrative  = await jiraiyaChain.invoke({
          context: '',
          input:   `${candidates.length} opportunité(s) d'upsell détectée(s) : ${candidates.map(c => `${c.client_name} ${c.current_package}→${c.target_package} +£${c.mrr_delta}/mois`).join(', ') || 'aucune'}. Commente et recommande les prochaines actions.`,
        });
        result = { candidates, count: candidates.length, narrative };
        break;
      }

      case 'generate_pitch': {
        const clientId = input['client_id'] as string | undefined;
        if (!clientId) throw new Error('client_id requis');
        const candidates = await detectOpportunities();
        const candidate  = candidates.find(c => c.client_id === clientId);
        if (!candidate) throw new Error(`Client ${clientId} non éligible à l'upsell`);
        const pitch = await generatePitch(candidate);
        result = { pitch };
        break;
      }

      case 'run_campaign': {
        const campaign = await runCampaign();
        result = { campaign };
        break;
      }

      case 'mark_converted': {
        const opportunityId = input['opportunity_id'] as string | undefined;
        if (!opportunityId) throw new Error('opportunity_id requis');
        await markConverted(opportunityId);
        result = { converted: opportunityId };
        break;
      }

      case 'mark_interested': {
        const opportunityId = input['opportunity_id'] as string | undefined;
        if (!opportunityId) throw new Error('opportunity_id requis');
        await markInterested(opportunityId);
        result = { interested: opportunityId };
        break;
      }

      case 'get_opportunities': {
        const status = input['status'] as string | undefined;
        const opps   = await getOpportunities(status);
        result = { opportunities: opps, count: opps.length };
        break;
      }

      case 'mrr_impact': {
        const impact = await getMrrImpact();
        result = { impact };
        break;
      }

      case 'advice': {
        const question = (input['question'] as string | undefined) ?? 'Comment optimiser notre pipeline upsell ?';
        const advice   = await jiraiyaChain.invoke({ context: '', input: question });
        result = { advice };
        break;
      }

      default:
        throw new Error(`Action inconnue : ${action}`);
    }

    void supabase.from('alerts').insert({ agent_name: 'JIRAIYA', level: 'INFO', message: `${action} OK` });

    return {
      agent_name:  'JIRAIYA',
      status:      'completed',
      task_result: result,
      error:       null,
      messages:    [...state.messages, userMsg, new AIMessage(JSON.stringify(result))],
    };

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void supabase.from('alerts').insert({ agent_name: 'JIRAIYA', level: 'WARNING', message });
    return {
      agent_name:  'JIRAIYA',
      status:      'failed',
      error:       message,
      messages:    [...state.messages, userMsg],
    };
  }
}
