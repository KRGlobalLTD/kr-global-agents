import { NextRequest, NextResponse }    from 'next/server';
import { detectOpportunities }          from '@/lib/agents/jiraiya/opportunity-detector';
import { generatePitch }                from '@/lib/agents/jiraiya/pitch-generator';
import { runCampaign, sendPitch }       from '@/lib/agents/jiraiya/campaign-runner';
import { markConverted, markInterested,
         getOpportunities, getMrrImpact } from '@/lib/agents/jiraiya/conversion-tracker';

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

      case 'detect_opportunities': {
        const candidates = await detectOpportunities();
        return NextResponse.json({ agent_name: 'JIRAIYA', candidates, count: candidates.length });
      }

      case 'generate_pitch': {
        const clientId = body['client_id'] as string | undefined;
        if (!clientId) return NextResponse.json({ error: 'client_id requis' }, { status: 400 });
        const candidates = await detectOpportunities();
        const candidate  = candidates.find(c => c.client_id === clientId);
        if (!candidate) return NextResponse.json({ error: 'Client non éligible à l\'upsell' }, { status: 404 });
        const pitch = await generatePitch(candidate);
        return NextResponse.json({ agent_name: 'JIRAIYA', pitch });
      }

      case 'run_campaign': {
        const result = await runCampaign();
        return NextResponse.json({ agent_name: 'JIRAIYA', ...result });
      }

      case 'send_pitch': {
        const opportunityId = body['opportunity_id'] as string | undefined;
        const email         = body['client_email']   as string | undefined;
        const subject       = body['subject']        as string | undefined;
        const html          = body['html']           as string | undefined;
        if (!opportunityId || !email || !subject || !html) {
          return NextResponse.json({ error: 'opportunity_id, client_email, subject et html requis' }, { status: 400 });
        }
        const sent = await sendPitch(opportunityId, email, subject, html);
        return NextResponse.json({ agent_name: 'JIRAIYA', sent });
      }

      case 'mark_converted': {
        const opportunityId = body['opportunity_id'] as string | undefined;
        if (!opportunityId) return NextResponse.json({ error: 'opportunity_id requis' }, { status: 400 });
        await markConverted(opportunityId);
        return NextResponse.json({ agent_name: 'JIRAIYA', converted: opportunityId });
      }

      case 'mark_interested': {
        const opportunityId = body['opportunity_id'] as string | undefined;
        if (!opportunityId) return NextResponse.json({ error: 'opportunity_id requis' }, { status: 400 });
        await markInterested(opportunityId);
        return NextResponse.json({ agent_name: 'JIRAIYA', interested: opportunityId });
      }

      case 'get_opportunities': {
        const status = body['status'] as string | undefined;
        const opps   = await getOpportunities(status);
        return NextResponse.json({ agent_name: 'JIRAIYA', opportunities: opps, count: opps.length });
      }

      case 'mrr_impact': {
        const impact = await getMrrImpact();
        return NextResponse.json({ agent_name: 'JIRAIYA', impact });
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

  const type = new URL(req.url).searchParams.get('type') ?? 'opportunities';

  try {
    if (type === 'opportunities') {
      const status = new URL(req.url).searchParams.get('status') ?? undefined;
      const opps   = await getOpportunities(status);
      return NextResponse.json({ agent_name: 'JIRAIYA', opportunities: opps, count: opps.length });
    }
    if (type === 'impact') {
      const impact = await getMrrImpact();
      return NextResponse.json({ agent_name: 'JIRAIYA', impact });
    }
    if (type === 'candidates') {
      const candidates = await detectOpportunities();
      return NextResponse.json({ agent_name: 'JIRAIYA', candidates, count: candidates.length });
    }
    return NextResponse.json({ error: `Type inconnu : ${type}` }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
