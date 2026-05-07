import { NextRequest, NextResponse }        from 'next/server';
import { findEcomProspects,
         getEcomProspects }                from '@/lib/agents/naruto/ecom-prospector';
import { writeOutreach }                   from '@/lib/agents/naruto/outreach-writer';
import { generateEcomContent,
         generateEcomContentBatch }        from '@/lib/agents/naruto/content-specialist';
import { runEcomCampaignCycle,
         getEcomCampaignStats }            from '@/lib/agents/naruto/campaign-manager';

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

      case 'run_campaign': {
        const result = await runEcomCampaignCycle();
        return NextResponse.json({ agent_name: 'NARUTO', ...result });
      }

      case 'find_prospects': {
        const campaignId = body['campaign_id'] as string | undefined;
        if (!campaignId) return NextResponse.json({ error: 'campaign_id requis' }, { status: 400 });
        const result = await findEcomProspects(campaignId, (body['page'] as number) ?? 1);
        return NextResponse.json({ agent_name: 'NARUTO', ...result });
      }

      case 'write_outreach': {
        const prospect = body['prospect'] as Parameters<typeof writeOutreach>[0] | undefined;
        if (!prospect) return NextResponse.json({ error: 'prospect requis' }, { status: 400 });
        const type  = (body['type'] as 'initial' | 'followup1' | 'followup2') ?? 'initial';
        const email = await writeOutreach(prospect, type);
        return NextResponse.json({ agent_name: 'NARUTO', email });
      }

      case 'generate_content': {
        const topic    = body['topic']    as string | undefined;
        const platform = (body['platform'] as string) ?? 'linkedin';
        const content  = await generateEcomContent(topic, platform);
        return NextResponse.json({ agent_name: 'NARUTO', content });
      }

      case 'content_batch': {
        const count    = (body['count'] as number) ?? 3;
        const contents = await generateEcomContentBatch(count);
        return NextResponse.json({ agent_name: 'NARUTO', contents, count: contents.length });
      }

      case 'get_prospects': {
        const prospects = await getEcomProspects((body['limit'] as number) ?? 50);
        return NextResponse.json({ agent_name: 'NARUTO', prospects, count: prospects.length });
      }

      case 'get_stats': {
        const stats = await getEcomCampaignStats();
        return NextResponse.json({ agent_name: 'NARUTO', stats });
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

  const type = new URL(req.url).searchParams.get('type') ?? 'stats';

  try {
    if (type === 'stats') {
      const stats = await getEcomCampaignStats();
      return NextResponse.json({ agent_name: 'NARUTO', stats });
    }
    if (type === 'prospects') {
      const limit     = parseInt(new URL(req.url).searchParams.get('limit') ?? '50');
      const prospects = await getEcomProspects(limit);
      return NextResponse.json({ agent_name: 'NARUTO', prospects, count: prospects.length });
    }
    return NextResponse.json({ error: `Type inconnu : ${type}` }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
