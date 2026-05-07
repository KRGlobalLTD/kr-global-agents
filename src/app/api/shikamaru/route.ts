import { NextRequest, NextResponse } from 'next/server';
import { analyzeProspectPricing,
         getMarketRates }            from '@/lib/agents/shikamaru/price-analyzer';
import { generateQuote, getProposals,
         updateProposalStatus }      from '@/lib/agents/shikamaru/quote-generator';
import { simulateRevenue }           from '@/lib/agents/shikamaru/revenue-simulator';
import { validateDiscount,
         checkExpiredProposals }     from '@/lib/agents/shikamaru/discount-manager';

function verifyInternalToken(req: NextRequest): boolean {
  return req.headers.get('x-internal-token') === process.env.INTERNAL_API_TOKEN;
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!verifyInternalToken(req)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; }
  catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }); }

  const action = (body['action'] as string) ?? '';

  try {
    switch (action) {

      case 'analyze_market': {
        const rates = getMarketRates();
        return NextResponse.json({ agent_name: 'SHIKAMARU', ...rates });
      }

      case 'analyze_prospect': {
        const brief = body['brief'] as string | undefined;
        if (!brief) return NextResponse.json({ error: 'brief requis' }, { status: 400 });
        const analysis = await analyzeProspectPricing(brief);
        return NextResponse.json({ agent_name: 'SHIKAMARU', analysis });
      }

      case 'generate_quote': {
        const prospectName = body['prospect_name'] as string | undefined;
        const brief        = body['brief']         as string | undefined;
        if (!prospectName || !brief) {
          return NextResponse.json({ error: 'prospect_name et brief requis' }, { status: 400 });
        }
        const quote = await generateQuote({
          prospect_name:     prospectName,
          prospect_id:       body['prospect_id']      as string | undefined,
          brief,
          budget_hint:       body['budget_hint']      as string | undefined,
          package_override:  body['package_override'] as 'starter' | 'growth' | 'enterprise' | 'custom' | undefined,
          custom_services:   body['custom_services']  as string[] | undefined,
          custom_price:      body['custom_price']     as number   | undefined,
          discount_pct:      body['discount_pct']     as number   | undefined,
          valid_days:        body['valid_days']        as number   | undefined,
        });
        return NextResponse.json({ agent_name: 'SHIKAMARU', quote });
      }

      case 'get_proposals': {
        const status    = body['status'] as string | undefined;
        const proposals = await getProposals(status);
        return NextResponse.json({ agent_name: 'SHIKAMARU', proposals, count: proposals.length });
      }

      case 'update_proposal': {
        const id     = body['id']     as string | undefined;
        const status = body['status'] as string | undefined;
        if (!id || !status) return NextResponse.json({ error: 'id et status requis' }, { status: 400 });
        await updateProposalStatus(id, status);
        return NextResponse.json({ agent_name: 'SHIKAMARU', updated: id, status });
      }

      case 'simulate_revenue': {
        const simulation = simulateRevenue(
          (body['current_clients'] as number) ?? 0,
          (body['current_mrr']     as number) ?? 0,
        );
        return NextResponse.json({ agent_name: 'SHIKAMARU', simulation });
      }

      case 'validate_discount': {
        const proposalId = body['proposal_id']            as string | undefined;
        const pct        = body['requested_discount_pct'] as number | undefined;
        const reason     = (body['reason']                as string | undefined) ?? '';
        if (!proposalId || pct === undefined) {
          return NextResponse.json({ error: 'proposal_id et requested_discount_pct requis' }, { status: 400 });
        }
        const decision = await validateDiscount({ proposal_id: proposalId, requested_discount_pct: pct, reason });
        return NextResponse.json({ agent_name: 'SHIKAMARU', decision });
      }

      case 'check_expired': {
        const result = await checkExpiredProposals();
        return NextResponse.json({ agent_name: 'SHIKAMARU', ...result });
      }

      default:
        return NextResponse.json({ error: `Action inconnue : ${action}` }, { status: 400 });
    }

  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!verifyInternalToken(req)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const type = new URL(req.url).searchParams.get('type') ?? 'proposals';

  try {
    if (type === 'proposals') {
      const proposals = await getProposals();
      return NextResponse.json({ agent_name: 'SHIKAMARU', proposals, count: proposals.length });
    }
    if (type === 'market') {
      return NextResponse.json({ agent_name: 'SHIKAMARU', ...getMarketRates() });
    }
    if (type === 'simulation') {
      return NextResponse.json({ agent_name: 'SHIKAMARU', simulation: simulateRevenue() });
    }
    return NextResponse.json({ error: `Type inconnu : ${type}` }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
