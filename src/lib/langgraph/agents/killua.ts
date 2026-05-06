import { HumanMessage, AIMessage } from '@langchain/core/messages';
import { type KRGlobalStateType } from '../state';
import { killuaChainJson } from '@/lib/langchain/chains/killua-chain';
import { getProspectContext, saveProspectMemory } from '@/lib/langchain/memory';
import { findProspects, type ProspectSearchFilters } from '@/lib/agents/killua/prospect-finder';
import { writeOutreachEmail, type ProspectProfile, type EmailType } from '@/lib/agents/killua/email-writer';
import { runCampaignCycle, getCampaignStats }                        from '@/lib/agents/killua/campaign-manager';
import { scrapeReddit }                                               from '@/lib/agents/killua/reddit-scraper';

type KilluaAction = 'scrape_leads' | 'send_outreach' | 'track_prospect' | 'scrape_reddit';

export async function killuaNode(state: KRGlobalStateType): Promise<Partial<KRGlobalStateType>> {
  const action = (state.task_input['action'] as KilluaAction) ?? 'scrape_leads';
  const input  = state.task_input;

  const userMsg = new HumanMessage(`KILLUA action=${action} input=${JSON.stringify(input)}`);

  try {
    let result: Record<string, unknown>;

    switch (action) {
      case 'scrape_leads': {
        const campaignId = (input['campaign_id'] as string) ?? '';
        if (!campaignId) throw new Error('campaign_id requis pour scrape_leads');

        const filters: ProspectSearchFilters = {
          industries:     input['industries']      as string[] | undefined,
          jobTitles:      input['job_titles']      as string[] | undefined,
          locations:      input['locations']       as string[] | undefined,
          employeeRanges: input['employee_ranges'] as string[] | undefined,
          keywords:       input['keywords']        as string   | undefined,
          page:           input['page']            as number   | undefined,
          perPage:        (input['per_page']       as number)  ?? 25,
        };

        const findResult = await findProspects(campaignId, filters);
        result = { found: findResult.found, saved: findResult.saved, skipped: findResult.skipped };
        break;
      }

      case 'send_outreach': {
        const profile: ProspectProfile = {
          firstName: (input['first_name'] as string) ?? '',
          lastName:  (input['last_name']  as string) ?? '',
          email:     (input['email']      as string) ?? '',
          jobTitle:  (input['job_title']  as string | null) ?? null,
          company:   (input['company']    as string | null) ?? null,
          industry:  (input['industry']   as string | null) ?? null,
        };
        const emailType = (input['email_type'] as EmailType) ?? 'initial';
        const context   = await getProspectContext(`${profile.company ?? ''} ${profile.industry ?? ''}`);
        const email     = await writeOutreachEmail(profile, emailType);

        await saveProspectMemory(
          profile.email,
          profile.company ?? '',
          `${profile.firstName} ${profile.lastName} — ${profile.jobTitle ?? ''} @ ${profile.company ?? ''}`,
        );

        if (input['campaign_id']) {
          await runCampaignCycle(input['campaign_id'] as string);
        }

        result = { email, context_used: context.length > 0 };
        break;
      }

      case 'track_prospect': {
        const campaignId = input['campaign_id'] as string | undefined;
        if (!campaignId) throw new Error('campaign_id requis pour track_prospect');
        const stats = await getCampaignStats(campaignId);
        result = { stats };
        break;
      }

      case 'scrape_reddit': {
        const subreddit = (input['subreddit'] as string) ?? 'artificial';
        const limit     = (input['limit']     as number) ?? 10;
        const scraped   = await scrapeReddit(subreddit, Math.min(limit, 25));
        result = {
          source:    scraped.source,
          subreddit: scraped.subreddit,
          fetched:   scraped.posts.length,
          saved:     scraped.saved,
          posts:     scraped.posts.map(p => ({ title: p.title, score: p.score, url: p.url })),
        };
        break;
      }

      default: {
        const context   = await getProspectContext(JSON.stringify(input));
        const reasoning = await killuaChainJson.invoke({
          context,
          input: `Tâche : ${JSON.stringify(input)}`,
        });
        result = { reasoning };
      }
    }

    return {
      agent_name:  'KILLUA',
      status:      'completed',
      task_result: result,
      error:       null,
      messages:    [userMsg, new AIMessage(`KILLUA completed action=${action}`)],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur KILLUA inconnue';
    return {
      agent_name: 'KILLUA',
      status:     'failed',
      error:      message,
      messages:   [userMsg, new AIMessage(`KILLUA error: ${message}`)],
    };
  }
}
