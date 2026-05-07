import { HumanMessage, AIMessage }      from '@langchain/core/messages';
import { createClient }                  from '@supabase/supabase-js';
import { type KRGlobalStateType }        from '../state';
import { sasukeChain }                   from '@/lib/langchain/chains/sasuke-chain';
import { findSaasProspects,
         getSaasProspects }              from '@/lib/agents/sasuke/saas-prospector';
import { writeOutreach }                 from '@/lib/agents/sasuke/outreach-writer';
import { generateSaasContent,
         generateSaasContentBatch }      from '@/lib/agents/sasuke/content-specialist';
import { runSaasCampaignCycle,
         getCampaignStats }              from '@/lib/agents/sasuke/campaign-manager';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

type SasukeAction =
  | 'run_campaign'
  | 'find_prospects'
  | 'write_outreach'
  | 'generate_content'
  | 'content_batch'
  | 'get_prospects'
  | 'get_stats'
  | 'advice';

export async function sasukeNode(state: KRGlobalStateType): Promise<Partial<KRGlobalStateType>> {
  const action = (state.task_input['action'] as SasukeAction) ?? 'run_campaign';
  const input  = state.task_input;

  const userMsg = new HumanMessage(`SASUKE action=${action} input=${JSON.stringify(input)}`);

  try {
    let result: Record<string, unknown>;

    switch (action) {

      case 'run_campaign': {
        const cycle = await runSaasCampaignCycle();
        const narrative = await sasukeChain.invoke({
          context: '',
          input:   `Cycle de prospection SaaS terminé : ${cycle.found} prospects trouvés, ${cycle.skipped} ignorés. Analyse et prochaines étapes.`,
        });
        result = { ...cycle, narrative };
        break;
      }

      case 'find_prospects': {
        const campaignId = input['campaign_id'] as string | undefined;
        if (!campaignId) throw new Error('campaign_id requis');
        const found = await findSaasProspects(campaignId, (input['page'] as number) ?? 1);
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
        const topic   = input['topic'] as string | undefined;
        const platform = (input['platform'] as string) ?? 'linkedin';
        const content = await generateSaasContent(topic, platform);
        result = { content };
        break;
      }

      case 'content_batch': {
        const count    = (input['count'] as number) ?? 3;
        const contents = await generateSaasContentBatch(count);
        result = { contents, count: contents.length };
        break;
      }

      case 'get_prospects': {
        const prospects = await getSaasProspects((input['limit'] as number) ?? 50);
        result = { prospects, count: prospects.length };
        break;
      }

      case 'get_stats': {
        const stats = await getCampaignStats();
        result = { stats };
        break;
      }

      case 'advice': {
        const question = (input['question'] as string | undefined) ?? 'Comment améliorer notre prospection SaaS ?';
        const advice   = await sasukeChain.invoke({ context: '', input: question });
        result = { advice };
        break;
      }

      default:
        throw new Error(`Action inconnue : ${action}`);
    }

    void supabase.from('alerts').insert({ agent_name: 'SASUKE', level: 'INFO', message: `${action} OK` });

    return {
      agent_name:  'SASUKE',
      status:      'completed',
      task_result: result,
      error:       null,
      messages:    [...state.messages, userMsg, new AIMessage(JSON.stringify(result))],
    };

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void supabase.from('alerts').insert({ agent_name: 'SASUKE', level: 'WARNING', message });
    return {
      agent_name:  'SASUKE',
      status:      'failed',
      error:       message,
      messages:    [...state.messages, userMsg],
    };
  }
}
