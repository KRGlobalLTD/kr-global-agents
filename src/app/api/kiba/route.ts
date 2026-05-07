import { NextRequest, NextResponse }   from 'next/server';
import { findPartnerCandidates,
         getPartnersByStatus }         from '@/lib/agents/kiba/partner-finder';
import { writePitch,
         generateProposal }            from '@/lib/agents/kiba/partnership-writer';
import { updatePartnerStatus,
         recordReferral,
         getPipelineStats }            from '@/lib/agents/kiba/partner-tracker';
import { calculateCommission,
         simulatePartnerRevenue }      from '@/lib/agents/kiba/commission-calculator';

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

      case 'find_partners': {
        const result = await findPartnerCandidates((body['page'] as number) ?? 1);
        return NextResponse.json({ agent_name: 'KIBA', ...result });
      }

      case 'run_campaign': {
        const found   = await findPartnerCandidates();
        const sample  = found.candidates.length > 0
          ? await writePitch(found.candidates[0], 'initial').catch(() => null)
          : null;
        return NextResponse.json({ agent_name: 'KIBA', ...found, sample_pitch: sample });
      }

      case 'write_pitch': {
        const partner = body['partner'] as Parameters<typeof writePitch>[0] | undefined;
        if (!partner) return NextResponse.json({ error: 'partner requis' }, { status: 400 });
        const type  = (body['type'] as 'initial' | 'followup') ?? 'initial';
        const email = await writePitch(partner, type);
        return NextResponse.json({ agent_name: 'KIBA', email });
      }

      case 'generate_proposal': {
        const company          = (body['company']           as string | undefined) ?? '';
        const companyType      = (body['company_type']      as string | undefined) ?? 'agency';
        const markets          = (body['markets']           as string | undefined) ?? 'UK, France';
        const estimatedClients = (body['estimated_clients'] as number) ?? 3;
        const proposal         = await generateProposal(company, companyType, markets, estimatedClients);
        return NextResponse.json({ agent_name: 'KIBA', proposal });
      }

      case 'update_status': {
        const partnerId = body['partner_id'] as string | undefined;
        const status    = body['status']     as Parameters<typeof updatePartnerStatus>[1] | undefined;
        if (!partnerId || !status) return NextResponse.json({ error: 'partner_id et status requis' }, { status: 400 });
        await updatePartnerStatus(partnerId, status, body['notes'] as string | undefined);
        return NextResponse.json({ agent_name: 'KIBA', updated: true, partner_id: partnerId, status });
      }

      case 'record_referral': {
        const partnerId  = body['partner_id']  as string | undefined;
        const revenueGbp = body['revenue_gbp'] as number | undefined;
        if (!partnerId || revenueGbp === undefined) return NextResponse.json({ error: 'partner_id et revenue_gbp requis' }, { status: 400 });
        await recordReferral(partnerId, revenueGbp);
        return NextResponse.json({ agent_name: 'KIBA', recorded: true });
      }

      case 'calculate_commission': {
        const partnerId = body['partner_id'] as string | undefined;
        if (!partnerId) return NextResponse.json({ error: 'partner_id requis' }, { status: 400 });
        const commission = await calculateCommission(partnerId);
        return NextResponse.json({ agent_name: 'KIBA', commission });
      }

      case 'simulate_revenue': {
        const clients = (body['estimated_clients_per_year'] as number) ?? 5;
        const pkg     = (body['avg_package'] as 'starter' | 'growth' | 'enterprise') ?? 'starter';
        const sim     = simulatePartnerRevenue(clients, pkg);
        return NextResponse.json({ agent_name: 'KIBA', simulation: sim });
      }

      case 'get_pipeline': {
        const status   = body['status']  as string | undefined;
        const limit    = (body['limit']  as number) ?? 50;
        const partners = await getPartnersByStatus(status, limit);
        return NextResponse.json({ agent_name: 'KIBA', partners, count: partners.length });
      }

      case 'get_stats': {
        const stats = await getPipelineStats();
        return NextResponse.json({ agent_name: 'KIBA', stats });
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

  const url    = new URL(req.url);
  const type   = url.searchParams.get('type') ?? 'stats';
  const status = url.searchParams.get('status') ?? undefined;
  const limit  = parseInt(url.searchParams.get('limit') ?? '50');

  try {
    if (type === 'stats') {
      const stats = await getPipelineStats();
      return NextResponse.json({ agent_name: 'KIBA', stats });
    }
    if (type === 'pipeline') {
      const partners = await getPartnersByStatus(status, limit);
      return NextResponse.json({ agent_name: 'KIBA', partners, count: partners.length });
    }
    if (type === 'simulate') {
      const clients = parseInt(url.searchParams.get('clients') ?? '5');
      const pkg     = (url.searchParams.get('package') ?? 'starter') as 'starter' | 'growth' | 'enterprise';
      const sim     = simulatePartnerRevenue(clients, pkg);
      return NextResponse.json({ agent_name: 'KIBA', simulation: sim });
    }
    return NextResponse.json({ error: `Type inconnu : ${type}` }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
