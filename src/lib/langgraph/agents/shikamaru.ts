import { HumanMessage, AIMessage }        from '@langchain/core/messages';
import { createClient }                    from '@supabase/supabase-js';
import { type KRGlobalStateType }          from '../state';
import { shikamaruChain }                  from '@/lib/langchain/chains/shikamaru-chain';
import { analyzeProspectPricing,
         getMarketRates }                  from '@/lib/agents/shikamaru/price-analyzer';
import { generateQuote, getProposals,
         updateProposalStatus }            from '@/lib/agents/shikamaru/quote-generator';
import { simulateRevenue }                 from '@/lib/agents/shikamaru/revenue-simulator';
import { validateDiscount,
         checkExpiredProposals }           from '@/lib/agents/shikamaru/discount-manager';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

type ShikamaruAction =
  | 'analyze_market'
  | 'analyze_prospect'
  | 'generate_quote'
  | 'get_proposals'
  | 'update_proposal'
  | 'simulate_revenue'
  | 'validate_discount'
  | 'check_expired'
  | 'pricing_advice';

export async function shikamaruNode(state: KRGlobalStateType): Promise<Partial<KRGlobalStateType>> {
  const action = (state.task_input['action'] as ShikamaruAction) ?? 'analyze_market';
  const input  = state.task_input;

  const userMsg = new HumanMessage(`SHIKAMARU action=${action} input=${JSON.stringify(input)}`);

  try {
    let result: Record<string, unknown>;

    switch (action) {

      case 'analyze_market': {
        const rates     = getMarketRates();
        const narrative = await shikamaruChain.invoke({
          context: '',
          input:   `Génère une analyse tarifaire du marché UK pour KR Global (${new Date().toISOString().split('T')[0]}).
Packages actuels : Starter £${rates.packages.starter.price}/mois, Growth £${rates.packages.growth.price}/mois, Enterprise £${rates.packages.enterprise.price}/mois.
Concurrents : agences marketing classiques £800-2000, agences IA spécialisées £2500-8000.
Donne 3 recommandations pour optimiser le positionnement tarifaire.`,
        });
        result = { market_rates: rates, narrative };
        break;
      }

      case 'analyze_prospect': {
        const brief = (input['brief'] as string | undefined) ?? '';
        if (!brief) throw new Error('brief requis');
        const analysis = await analyzeProspectPricing(brief);
        result = { analysis };
        break;
      }

      case 'generate_quote': {
        const prospectName = input['prospect_name'] as string | undefined;
        const brief        = input['brief']         as string | undefined;
        if (!prospectName || !brief) throw new Error('prospect_name et brief requis');
        const quote = await generateQuote({
          prospect_name:     prospectName,
          prospect_id:       input['prospect_id']      as string | undefined,
          brief,
          budget_hint:       input['budget_hint']      as string | undefined,
          package_override:  input['package_override'] as 'starter' | 'growth' | 'enterprise' | 'custom' | undefined,
          custom_services:   input['custom_services']  as string[] | undefined,
          custom_price:      input['custom_price']     as number   | undefined,
          discount_pct:      input['discount_pct']     as number   | undefined,
          valid_days:        input['valid_days']        as number   | undefined,
        });
        result = { quote };
        break;
      }

      case 'get_proposals': {
        const status    = input['status'] as string | undefined;
        const proposals = await getProposals(status);
        result = { proposals, count: proposals.length };
        break;
      }

      case 'update_proposal': {
        const id     = input['id']     as string | undefined;
        const status = input['status'] as string | undefined;
        if (!id || !status) throw new Error('id et status requis');
        await updateProposalStatus(id, status);
        result = { updated: id, status };
        break;
      }

      case 'simulate_revenue': {
        const currentClients = (input['current_clients'] as number) ?? 0;
        const currentMrr     = (input['current_mrr']     as number) ?? 0;
        const simulation     = simulateRevenue(currentClients, currentMrr);
        const narrative      = await shikamaruChain.invoke({
          context: '',
          input:   `Commente cette simulation de revenus KR Global et identifie la meilleure stratégie de croissance :\n${JSON.stringify(simulation, null, 2)}`,
        });
        result = { simulation, narrative };
        break;
      }

      case 'validate_discount': {
        const proposalId = input['proposal_id']            as string | undefined;
        const pct        = input['requested_discount_pct'] as number | undefined;
        const reason     = (input['reason']                as string | undefined) ?? '';
        if (!proposalId || pct === undefined) throw new Error('proposal_id et requested_discount_pct requis');
        const decision = await validateDiscount({ proposal_id: proposalId, requested_discount_pct: pct, reason });
        result = { decision };
        break;
      }

      case 'check_expired': {
        const expired = await checkExpiredProposals();
        result = expired;
        break;
      }

      case 'pricing_advice': {
        const question = (input['question'] as string | undefined) ?? 'Comment optimiser notre pricing ?';
        const advice   = await shikamaruChain.invoke({ context: '', input: question });
        result = { advice };
        break;
      }

      default:
        throw new Error(`Action inconnue : ${action}`);
    }

    void supabase.from('alerts').insert({ agent_name: 'SHIKAMARU', level: 'INFO', message: `${action} OK` });

    return {
      agent_name:  'SHIKAMARU',
      status:      'completed',
      task_result: result,
      error:       null,
      messages:    [...state.messages, userMsg, new AIMessage(JSON.stringify(result))],
    };

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void supabase.from('alerts').insert({ agent_name: 'SHIKAMARU', level: 'WARNING', message });
    return {
      agent_name:  'SHIKAMARU',
      status:      'failed',
      error:       message,
      messages:    [...state.messages, userMsg],
    };
  }
}
