import { HumanMessage, AIMessage }         from '@langchain/core/messages';
import { createClient }                     from '@supabase/supabase-js';
import { type KRGlobalStateType }           from '../state';
import { narutoChain }                      from '@/lib/langchain/chains/naruto-chain';
import { findEcomProspects,
         getEcomProspects }                 from '@/lib/agents/naruto/ecom-prospector';
import { writeOutreach }                    from '@/lib/agents/naruto/outreach-writer';
import { generateEcomContent,
         generateEcomContentBatch }         from '@/lib/agents/naruto/content-specialist';
import { runEcomCampaignCycle,
         getEcomCampaignStats }             from '@/lib/agents/naruto/campaign-manager';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

type NarutoAction =
  | 'run_campaign'
  | 'find_prospects'
  | 'write_outreach'
  | 'generate_content'
  | 'content_batch'
  | 'get_prospects'
  | 'get_stats'
  | 'advice';

export async function narutoNode(state: KRGlobalStateType): Promise<Partial<KRGlobalStateType>> {
  const action = (state.task_input['action'] as NarutoAction) ?? 'run_campaign';
  const input  = state.task_input;

  const userMsg = new HumanMessage(`NARUTO action=${action} input=${JSON.stringify(input)}`);

  try {
    let result: Record<string, unknown>;

    switch (action) {

      case 'run_campaign': {
        const cycle = await runEcomCampaignCycle();
        const narrative = await narutoChain.invoke({
          context: '',
          input:   `Cycle e-commerce terminé : ${cycle.found} prospects trouvés, ${cycle.skipped} ignorés. Analyse et prochaines étapes.`,
        });
        result = { ...cycle, narrative };
        break;
      }

      case 'find_prospects': {
        const campaignId = input['campaign_id'] as string | undefined;
        if (!campaignId) throw new Error('campaign_id requis');
        const found = await findEcomProspects(campaignId, (input['page'] as number) ?? 1);
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
        const content  = await generateEcomContent(topic, platform);
        result = { content };
        break;
      }

      case 'content_batch': {
        const count    = (input['count'] as number) ?? 3;
        const contents = await generateEcomContentBatch(count);
        result = { contents, count: contents.length };
        break;
      }

      case 'get_prospects': {
        const prospects = await getEcomProspects((input['limit'] as number) ?? 50);
        result = { prospects, count: prospects.length };
        break;
      }

      case 'get_stats': {
        const stats = await getEcomCampaignStats();
        result = { stats };
        break;
      }

      case 'advice': {
        const question = (input['question'] as string | undefined) ?? "Comment améliorer notre prospection e-commerce ?";
        const advice   = await narutoChain.invoke({ context: '', input: question });
        result = { advice };
        break;
      }

      default:
        throw new Error(`Action inconnue : ${action}`);
    }

    void supabase.from('alerts').insert({ agent_name: 'NARUTO', level: 'INFO', message: `${action} OK` });

    return {
      agent_name:  'NARUTO',
      status:      'completed',
      task_result: result,
      error:       null,
      messages:    [...state.messages, userMsg, new AIMessage(JSON.stringify(result))],
    };

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void supabase.from('alerts').insert({ agent_name: 'NARUTO', level: 'WARNING', message });
    return {
      agent_name: 'NARUTO',
      status:     'failed',
      error:      message,
      messages:   [...state.messages, userMsg],
    };
  }
}
