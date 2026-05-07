import { HumanMessage, AIMessage }         from '@langchain/core/messages';
import { createClient }                     from '@supabase/supabase-js';
import { type KRGlobalStateType }           from '../state';
import { temariChain }                      from '@/lib/langchain/chains/temari-chain';
import { findImmoProspects,
         getImmoProspects }                 from '@/lib/agents/temari/immo-prospector';
import { writeOutreach }                    from '@/lib/agents/temari/outreach-writer';
import { generateImmoContent,
         generateImmoContentBatch }         from '@/lib/agents/temari/content-specialist';
import { runImmoCampaignCycle,
         getImmoCampaignStats }             from '@/lib/agents/temari/campaign-manager';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

type TemariAction =
  | 'run_campaign'
  | 'find_prospects'
  | 'write_outreach'
  | 'generate_content'
  | 'content_batch'
  | 'get_prospects'
  | 'get_stats'
  | 'advice';

export async function temariNode(state: KRGlobalStateType): Promise<Partial<KRGlobalStateType>> {
  const action = (state.task_input['action'] as TemariAction) ?? 'run_campaign';
  const input  = state.task_input;

  const userMsg = new HumanMessage(`TEMARI action=${action} input=${JSON.stringify(input)}`);

  try {
    let result: Record<string, unknown>;

    switch (action) {

      case 'run_campaign': {
        const cycle = await runImmoCampaignCycle();
        const narrative = await temariChain.invoke({
          context: '',
          input:   `Cycle immobilier terminé : ${cycle.found} prospects trouvés, ${cycle.skipped} ignorés. Analyse et prochaines étapes.`,
        });
        result = { ...cycle, narrative };
        break;
      }

      case 'find_prospects': {
        const campaignId = input['campaign_id'] as string | undefined;
        if (!campaignId) throw new Error('campaign_id requis');
        const found = await findImmoProspects(campaignId, (input['page'] as number) ?? 1);
        result = { found };
        break;
      }

      case 'write_outreach': {
        const prospect = input['prospect'] as Parameters<typeof writeOutreach>[0] | undefined;
        if (!prospect) throw new Error('prospect requis');
        const type  = (input['type'] as 'initial' | 'followup1' | 'followup2') ?? 'initial';
        const email = await writeOutreach(prospect, type);
        result = { email };
        break;
      }

      case 'generate_content': {
        const topic    = input['topic']    as string | undefined;
        const platform = (input['platform'] as string) ?? 'linkedin';
        const content  = await generateImmoContent(topic, platform);
        result = { content };
        break;
      }

      case 'content_batch': {
        const count    = (input['count'] as number) ?? 3;
        const contents = await generateImmoContentBatch(count);
        result = { contents, count: contents.length };
        break;
      }

      case 'get_prospects': {
        const prospects = await getImmoProspects((input['limit'] as number) ?? 50);
        result = { prospects, count: prospects.length };
        break;
      }

      case 'get_stats': {
        const stats = await getImmoCampaignStats();
        result = { stats };
        break;
      }

      case 'advice': {
        const question = (input['question'] as string | undefined) ?? "Comment améliorer notre prospection immobilière ?";
        const advice   = await temariChain.invoke({ context: '', input: question });
        result = { advice };
        break;
      }

      default:
        throw new Error(`Action inconnue : ${action}`);
    }

    void supabase.from('alerts').insert({ agent_name: 'TEMARI', level: 'INFO', message: `${action} OK` });

    return {
      agent_name:  'TEMARI',
      status:      'completed',
      task_result: result,
      error:       null,
      messages:    [...state.messages, userMsg, new AIMessage(JSON.stringify(result))],
    };

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void supabase.from('alerts').insert({ agent_name: 'TEMARI', level: 'WARNING', message });
    return {
      agent_name: 'TEMARI',
      status:     'failed',
      error:      message,
      messages:   [...state.messages, userMsg],
    };
  }
}
