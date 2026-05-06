import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { findProspects, type ProspectSearchFilters } from '@/lib/agents/killua/prospect-finder';
import { writeOutreachEmail } from '@/lib/agents/killua/email-writer';
import {
  runCampaignCycle,
  createCampaign,
  getCampaignStats,
} from '@/lib/agents/killua/campaign-manager';
import { scrapeReddit } from '@/lib/agents/killua/reddit-scraper';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function verifyInternalToken(request: NextRequest): boolean {
  return request.headers.get('x-internal-token') === process.env.INTERNAL_API_TOKEN;
}

// ---- Payload types ----

type ActionPayload =
  | { action: 'find_prospects'; campaignId: string; filters: ProspectSearchFilters }
  | { action: 'run_campaign'; campaignId?: string }
  | { action: 'create_campaign'; name: string; filters: ProspectSearchFilters }
  | { action: 'send_email'; prospectEmail: string; prospectName: string; company?: string; jobTitle?: string; industry?: string; emailType: 'initial' | 'followup1' | 'followup2' }
  | { action: 'mark_replied'; prospectId: string }
  | { action: 'scrape_reddit'; subreddit?: string; limit?: number };

// ---- POST ----

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!verifyInternalToken(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  let body: ActionPayload;
  try {
    body = (await request.json()) as ActionPayload;
  } catch {
    return NextResponse.json({ error: 'Corps de requête invalide' }, { status: 400 });
  }

  try {
    switch (body.action) {
      case 'find_prospects': {
        const result = await findProspects(body.campaignId, body.filters);
        return NextResponse.json({ success: true, result });
      }

      case 'run_campaign': {
        const result = await runCampaignCycle(body.campaignId);
        return NextResponse.json({ success: true, result });
      }

      case 'create_campaign': {
        const id = await createCampaign(body.name, body.filters);
        return NextResponse.json({ success: true, campaignId: id });
      }

      case 'send_email': {
        const { firstName, lastName } = (() => {
          const parts = body.prospectName.trim().split(' ');
          return { firstName: parts[0] ?? body.prospectName, lastName: parts.slice(1).join(' ') };
        })();

        const email = await writeOutreachEmail(
          {
            firstName,
            lastName,
            email:    body.prospectEmail,
            jobTitle: body.jobTitle ?? null,
            company:  body.company  ?? null,
            industry: body.industry ?? null,
          },
          body.emailType
        );
        return NextResponse.json({ success: true, email });
      }

      case 'scrape_reddit': {
        const result = await scrapeReddit(
          body.subreddit ?? 'artificial',
          Math.min(body.limit ?? 10, 25)
        );
        return NextResponse.json({
          agent_name: 'KILLUA',
          source:     result.source,
          subreddit:  result.subreddit,
          fetched:    result.posts.length,
          saved:      result.saved,
          posts:      result.posts.map(p => ({ title: p.title, score: p.score, url: p.url })),
        });
      }

      case 'mark_replied': {
        const { error } = await supabase
          .from('prospects')
          .update({
            outreach_replied_at: new Date().toISOString(),
            status: 'CHAUD',
          })
          .eq('id', body.prospectId);

        if (error) throw new Error(error.message);

        await supabase.from('alerts').insert({
          agent_name: 'KILLUA',
          level: 'INFO',
          message: `Prospect id=${body.prospectId} marqué comme ayant répondu`,
        });

        return NextResponse.json({ success: true });
      }

      default: {
        return NextResponse.json({ error: 'Action inconnue' }, { status: 400 });
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur interne';

    try {
      await supabase.from('alerts').insert({
        agent_name: 'KILLUA',
        level: 'URGENT',
        message: `Erreur API KILLUA : action=${body.action}`,
      });
    } catch {
      // log silencieux
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ---- GET — stats campagne ----

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!verifyInternalToken(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const campaignId = searchParams.get('campaignId');

  if (campaignId) {
    const stats = await getCampaignStats(campaignId);
    return NextResponse.json({ success: true, stats });
  }

  // Toutes les campagnes actives
  const { data: campaigns, error } = await supabase
    .from('campaigns')
    .select('id, name, status, total_prospects, emails_sent, replies, conversions, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    agent:     'KILLUA',
    status:    'ACTIF',
    campaigns: campaigns ?? [],
  });
}
