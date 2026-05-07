import { NextRequest, NextResponse }   from 'next/server';
import { scoreClient, scoreAllClients,
         getAtRiskClients }            from '@/lib/agents/kakashi/health-scorer';
import { sendCheckin, sendDueCheckins } from '@/lib/agents/kakashi/checkin-manager';
import { recordNps, getNpsSummary }    from '@/lib/agents/kakashi/nps-tracker';
import { detectChurnRisks,
         detectUpsellOpportunities,
         generateClientReport }        from '@/lib/agents/kakashi/churn-predictor';

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

      case 'score_all': {
        const result = await scoreAllClients();
        return NextResponse.json({ agent_name: 'KAKASHI', ...result });
      }

      case 'score_client': {
        const clientId = body['client_id'] as string | undefined;
        if (!clientId) return NextResponse.json({ error: 'client_id requis' }, { status: 400 });
        const health = await scoreClient(clientId);
        return NextResponse.json({ agent_name: 'KAKASHI', health });
      }

      case 'get_at_risk': {
        const atRisk = await getAtRiskClients();
        return NextResponse.json({ agent_name: 'KAKASHI', at_risk: atRisk, count: atRisk.length });
      }

      case 'send_checkin': {
        const clientId = body['client_id'] as string | undefined;
        if (!clientId) return NextResponse.json({ error: 'client_id requis' }, { status: 400 });
        const result = await sendCheckin(clientId);
        return NextResponse.json({ agent_name: 'KAKASHI', checkin: result });
      }

      case 'send_due_checkins': {
        const result = await sendDueCheckins();
        return NextResponse.json({ agent_name: 'KAKASHI', ...result });
      }

      case 'record_nps': {
        const clientId = body['client_id'] as string | undefined;
        const score    = body['score']     as number | undefined;
        if (!clientId || score === undefined) {
          return NextResponse.json({ error: 'client_id et score requis' }, { status: 400 });
        }
        await recordNps({ client_id: clientId, score, comment: body['comment'] as string | undefined });
        return NextResponse.json({ agent_name: 'KAKASHI', recorded: true });
      }

      case 'nps_summary': {
        const summary = await getNpsSummary();
        return NextResponse.json({ agent_name: 'KAKASHI', nps: summary });
      }

      case 'detect_churn': {
        const risks = await detectChurnRisks();
        return NextResponse.json({ agent_name: 'KAKASHI', risks, count: risks.length });
      }

      case 'detect_upsell': {
        const opps = await detectUpsellOpportunities();
        return NextResponse.json({ agent_name: 'KAKASHI', opportunities: opps, count: opps.length });
      }

      case 'client_report': {
        const clientId = body['client_id'] as string | undefined;
        if (!clientId) return NextResponse.json({ error: 'client_id requis' }, { status: 400 });
        const report = await generateClientReport(clientId);
        return NextResponse.json({ agent_name: 'KAKASHI', report });
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

  const type = new URL(req.url).searchParams.get('type') ?? 'at_risk';

  try {
    if (type === 'at_risk') {
      const atRisk = await getAtRiskClients();
      return NextResponse.json({ agent_name: 'KAKASHI', at_risk: atRisk, count: atRisk.length });
    }
    if (type === 'nps') {
      const summary = await getNpsSummary();
      return NextResponse.json({ agent_name: 'KAKASHI', nps: summary });
    }
    if (type === 'upsell') {
      const opps = await detectUpsellOpportunities();
      return NextResponse.json({ agent_name: 'KAKASHI', opportunities: opps, count: opps.length });
    }
    if (type === 'churn') {
      const risks = await detectChurnRisks();
      return NextResponse.json({ agent_name: 'KAKASHI', risks, count: risks.length });
    }
    return NextResponse.json({ error: `Type inconnu : ${type}` }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
