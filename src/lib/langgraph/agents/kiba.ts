import { HumanMessage, AIMessage }     from '@langchain/core/messages';
import { createClient }                 from '@supabase/supabase-js';
import { type KRGlobalStateType }       from '../state';
import { kibaChain }                    from '@/lib/langchain/chains/kiba-chain';
import { findPartnerCandidates,
         getPartnersByStatus }          from '@/lib/agents/kiba/partner-finder';
import { writePitch,
         generateProposal }             from '@/lib/agents/kiba/partnership-writer';
import { updatePartnerStatus,
         recordReferral,
         getPipelineStats }             from '@/lib/agents/kiba/partner-tracker';
import { calculateCommission,
         simulatePartnerRevenue }       from '@/lib/agents/kiba/commission-calculator';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

type KibaAction =
  | 'find_partners'
  | 'run_campaign'
  | 'write_pitch'
  | 'generate_proposal'
  | 'update_status'
  | 'record_referral'
  | 'calculate_commission'
  | 'simulate_revenue'
  | 'get_pipeline'
  | 'get_stats'
  | 'advice';

export async function kibaNode(state: KRGlobalStateType): Promise<Partial<KRGlobalStateType>> {
  const action = (state.task_input['action'] as KibaAction) ?? 'get_stats';
  const input  = state.task_input;

  const userMsg = new HumanMessage(`KIBA action=${action} input=${JSON.stringify(input)}`);

  try {
    let result: Record<string, unknown>;

    switch (action) {

      case 'find_partners': {
        const found = await findPartnerCandidates((input['page'] as number) ?? 1);
        result = found;
        break;
      }

      case 'run_campaign': {
        const found = await findPartnerCandidates();
        const sample = found.candidates.length > 0
          ? await writePitch(found.candidates[0], 'initial').catch(() => null)
          : null;
        if (found.saved > 0) {
          void fetch(process.env.SLACK_WEBHOOK_PROSPECTS!, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ text: `🤝 KIBA — ${found.saved} nouveaux partenaires potentiels identifiés` }),
          });
        }
        result = { ...found, sample_pitch: sample };
        break;
      }

      case 'write_pitch': {
        const partner = input['partner'] as Parameters<typeof writePitch>[0] | undefined;
        if (!partner) throw new Error('partner requis');
        const type  = (input['type'] as 'initial' | 'followup') ?? 'initial';
        const email = await writePitch(partner, type);
        result = { email };
        break;
      }

      case 'generate_proposal': {
        const company          = (input['company']           as string | undefined) ?? '';
        const companyType      = (input['company_type']      as string | undefined) ?? 'agency';
        const markets          = (input['markets']           as string | undefined) ?? 'UK, France';
        const estimatedClients = (input['estimated_clients'] as number) ?? 3;
        const proposal         = await generateProposal(company, companyType, markets, estimatedClients);
        result = { proposal };
        break;
      }

      case 'update_status': {
        const partnerId = input['partner_id'] as string | undefined;
        const status    = input['status']     as Parameters<typeof updatePartnerStatus>[1] | undefined;
        if (!partnerId || !status) throw new Error('partner_id et status requis');
        await updatePartnerStatus(partnerId, status, input['notes'] as string | undefined);
        result = { updated: true, partner_id: partnerId, status };
        break;
      }

      case 'record_referral': {
        const partnerId   = input['partner_id']   as string | undefined;
        const revenueGbp  = input['revenue_gbp']  as number | undefined;
        if (!partnerId || revenueGbp === undefined) throw new Error('partner_id et revenue_gbp requis');
        await recordReferral(partnerId, revenueGbp);
        result = { recorded: true, partner_id: partnerId, revenue_gbp: revenueGbp };
        break;
      }

      case 'calculate_commission': {
        const partnerId = input['partner_id'] as string | undefined;
        if (!partnerId) throw new Error('partner_id requis');
        const commission = await calculateCommission(partnerId);
        result = { commission };
        break;
      }

      case 'simulate_revenue': {
        const clients  = (input['estimated_clients_per_year'] as number) ?? 5;
        const pkg      = (input['avg_package'] as 'starter' | 'growth' | 'enterprise') ?? 'starter';
        const sim      = simulatePartnerRevenue(clients, pkg);
        result = { simulation: sim };
        break;
      }

      case 'get_pipeline': {
        const status    = input['status']         as string | undefined;
        const limit     = (input['limit']         as number) ?? 50;
        const partners  = await getPartnersByStatus(status, limit);
        result = { partners, count: partners.length };
        break;
      }

      case 'get_stats': {
        const stats = await getPipelineStats();
        result = { stats };
        break;
      }

      case 'advice': {
        const question = (input['question'] as string | undefined) ?? "Comment accélérer le développement de notre réseau partenaires ?";
        const advice   = await kibaChain.invoke({ context: '', input: question });
        result = { advice };
        break;
      }

      default:
        throw new Error(`Action inconnue : ${action}`);
    }

    void supabase.from('alerts').insert({ agent_name: 'KIBA', level: 'INFO', message: `${action} OK` });

    return {
      agent_name:  'KIBA',
      status:      'completed',
      task_result: result,
      error:       null,
      messages:    [...state.messages, userMsg, new AIMessage(JSON.stringify(result))],
    };

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void supabase.from('alerts').insert({ agent_name: 'KIBA', level: 'WARNING', message });
    return {
      agent_name: 'KIBA',
      status:     'failed',
      error:      message,
      messages:   [...state.messages, userMsg],
    };
  }
}
